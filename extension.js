//    Snap Menu
//    GNOME Shell extension
//    @fthx 2025
//    snap-symbolic icon copied from Yaru icons


import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Snapd from 'gi://Snapd';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui//messageTray.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';


const SnapMenuButton = GObject.registerClass(
    class SnapMenuButton extends PanelMenu.Button {
        _init(path) {
            super._init(0.5);

            this._path = path;

            this._snapdClient = new Snapd.Client();
            if (!this._snapdClient) {
                this._showNotification('Snap menu extension :: Init', 'Error: no snapd client found');
                return;
            }

            this._snapdClientForMonitoring = new Snapd.Client();
            this._snapdNoticesMonitor = Snapd.NoticesMonitor.new_with_client(this._snapdClientForMonitoring);
            this._snapdNoticesMonitor?.start();

            this._makeButtonBox();
            this._updateMenu();

            this._snapdNoticesMonitor?.connectObject('notice-event', () => this._updateMenu(), this);
        }

        _makeButtonBox() {
            this._box = new St.BoxLayout();

            const iconPath = `${this._path}/snap-symbolic.svg`;
            const snapGIcon = Gio.icon_new_for_string(iconPath);

            this._icon = new St.Icon({ gicon: snapGIcon, style_class: 'system-status-icon' });
            this._box.add_child(this._icon);

            this.add_child(this._box);

            const monitorHeight = Main.layoutManager.primaryMonitor?.height ?? 1080;
            this._scrollView = new St.ScrollView({
                style_class: 'vfade',
                overlay_scrollbars: true,
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                style: `max-height: ${Math.round(monitorHeight / 3)}px;`,
            });

            this._menuSection = new PopupMenu.PopupMenuSection();
            this._menuSection.actor.set_style('padding-right: 16px;');
            this._scrollView.set_child(this._menuSection.actor);
        }

        _populateMenu() {
            this.menu?.removeAll();
            this._menuSection?.removeAll();

            this.menu.box.add_child(this._scrollView);

            for (const snap of this._snapsList) {
                const snapMenuItem = new PopupMenu.PopupSubMenuMenuItem(snap?.name ?? 'Unknown');
                this._menuSection.addMenuItem(snapMenuItem);

                snapMenuItem.menu.addAction('Info', () => this._showSnapInfo(snap));
                snapMenuItem.menu.addAction('Apps', () => this._showSnapApps(snap));
                snapMenuItem.menu.addAction('Remove', () => this._removeSnapDialog(snap));
            }

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const toolsMenuItem = new PopupMenu.PopupSubMenuMenuItem("Tools");
            this.menu.addMenuItem(toolsMenuItem);

            toolsMenuItem.menu.addAction("Refresh snaps", () => this._refreshSnaps());
            toolsMenuItem.menu.addAction("Recent changes", () => this._getChanges());
            toolsMenuItem.menu.addAction("Install snap...", () => this._installSnapDialog());
        }

        _updateMenu() {
            this._snapdClient?.get_snaps_async(
                Snapd.GetAppsFlags.NONE,
                null,
                null,
                (client, result) => {
                    this._snapsList = client.get_snaps_finish(result);
                    this._snapsList.sort((a, b) => a?.name > b?.name);

                    this._populateMenu();
                }
            );
        }

        _refreshSnaps() {
            this._snapdClient?.refresh_all_async(
                null,
                null,
                (client, result) => {
                    try {
                        const refreshedSnaps = client.refresh_all_finish(result)?.join(' — ');
                        this._showNotification('Snap menu extension :: Refresh', `Refreshed snaps: ${refreshedSnaps}.`);
                    } catch (e) {
                        if (e.message && e.message.includes('Unexpected result type')) {
                            this._showNotification('Snap menu extension :: Refresh', 'No refresh found.');
                        } else
                            this._showNotification('Snap menu extension :: Refresh', 'Error: ' + e.message);
                    }
                }
            );
        }

        _getChanges() {
            this._snapdClient?.get_changes_async(
                Snapd.ChangeFilter.ALL,
                null,
                null,
                (client, result) => {
                    try {
                        const changesList = client.get_changes_finish(result);
                        const summaries = changesList.map(change => change.get_summary());
                        this._showNotification('Snap menu extension :: Changes', summaries.join(' — '));
                    } catch (e) {
                        if (e.message && e.message.includes('Unexpected result type')) {
                            this._showNotification('Snap menu extension :: Changes', 'No changes.');
                        } else
                            this._showNotification('Snap menu extension :: Changes', 'Error: ' + e.message);
                    }
                }
            );
        }

        _showSnapInfo(snap) {
            this.menu?.close();

            const version = snap?.version ?? 'N/A';
            const revision = snap?.revision ?? 'N/A';
            const channel = snap?.channel ?? 'N/A';
            const summary = snap?.summary ?? 'N/A';

            this._showNotification(
                `Snap menu extension :: Info`,
                `${snap?.title} ${version} (${revision} - ${channel}) — ${summary}`
            )
        }

        _showSnapApps(snap) {
            this.menu?.close();

            const apps = snap?.get_apps() ?? [];
            const appNames = apps?.map(app => app?.name);

            this._showNotification(
                'Snap menu extension :: Apps',
                `Apps from ${snap?.title}: ${appNames.join(' — ')}.`
            )
        }

        _installSnapDialog() {
            const dialog = new ModalDialog.ModalDialog();

            const title = new St.Label({
                text: 'Snap menu extension :: Install snap',
                style: 'font-weight: bold;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            dialog.contentLayout.add_child(title);

            const entry = new St.Entry({
                can_focus: true,
                hint_text: 'Enter snap name',
            });
            dialog.contentLayout.add_child(entry);

            dialog.setButtons([
                {
                    label: 'Cancel',
                    action: () => dialog.close(),
                    key: Clutter.KEY_Escape,
                },
                {
                    label: 'Install',
                    action: () => {
                        const snapName = entry.text.trim();
                        dialog.close();
                        this._installSnap(snapName);
                    },
                },
            ]);

            dialog.open();
        }

        _installSnap(snapName) {
            this._snapdClient.install2_async(
                Snapd.InstallFlags.NONE,
                snapName,
                null,
                null,
                null,
                null,
                (client, result) => {
                    try {
                        client.install2_finish(result);

                        this._showNotification(
                            'Snap menu extension :: Install snap',
                            `Snap ${snapName} installed.`
                        )
                    } catch (e) {
                        this._showNotification('Error: ', e.message);
                    }
                }
            );
        }

        _removeSnapDialog(snap) {
            const dialog = new ModalDialog.ModalDialog();

            const title = new St.Label({
                text: 'Snap menu extension :: Remove snap',
                style: 'font-weight: bold;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            dialog.contentLayout.add_child(title);

            const body = new St.Label({
                text: `Warning: really remove snap ${snap?.name} ?`,
            });
            dialog.contentLayout.add_child(body);

            dialog.setButtons([
                {
                    label: 'Cancel',
                    action: () => dialog.close(),
                    key: Clutter.KEY_Escape,
                },
                {
                    label: 'Remove',
                    action: () => {
                        dialog.close();
                        this._removeSnap(snap);
                    },
                },
            ]);

            dialog.open();
        }

        _removeSnap(snap) {
            this._snapdClient.remove_async(
                snap?.name,
                null,
                null,
                (client, result) => {
                    try {
                        client.remove_finish(result);

                        this._showNotification(
                            'Snap menu extension :: Remove snap',
                            `Snap ${snap?.name} removed.`
                        )
                    } catch (e) {
                        this._showNotification('Error: ', e.message);
                    }
                }
            );
        }

        _showNotification(title, body) {
            const source = MessageTray.getSystemSource();

            const notification = new MessageTray.Notification({
                source: source,
                title: title,
                body: body,
                isTransient: false,
            });
            notification.urgency = MessageTray.Urgency.CRITICAL;
            source.addNotification(notification);
        }

        destroy() {
            this._snapdNoticesMonitor?.disconnectObject(this);
            this._snapdNoticesMonitor?.stop();

            this._snapdNoticesMonitor = null;
            this._snapdClientForMonitoring = null;
            this._snapdClient = null;

            this.menu?.removeAll();

            super.destroy();
        }
    });

export default class SnapMenuExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this._snapMenuButton = new SnapMenuButton(this.path);

        if (!Main.panel.statusArea['Snap Menu Button'])
            Main.panel.addToStatusArea('Snap Menu Button', this._snapMenuButton);
    }

    disable() {
        this._snapMenuButton?.destroy();
        this._snapMenuButton = null;
    }
}
