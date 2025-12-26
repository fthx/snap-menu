//    Snap Menu
//    GNOME Shell extension
//    @fthx 2025
//    snap-symbolic icon copied from Yaru icons


import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
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

            this._makeMenuButtonBox();
            this._updateSnapsMenu();

            this._menuIsUpdating = false;
            this._snapdNoticesMonitor?.connectObject('notice-event', () => this._updateSnapsMenu(), this);
        }

        _makeMenuButtonBox() {
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

            // Tools
            this._menuSectionTools = new PopupMenu.PopupMenuSection();
            this._menuSectionTools.actor.set_style('padding-right: 16px;');

            this.menu.addMenuItem(this._menuSectionTools);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const toolsMenuItem = new PopupMenu.PopupSubMenuMenuItem("Tools");
            toolsMenuItem.menu.addAction("Refresh snaps", () => this._refreshSnaps());
            toolsMenuItem.menu.addAction("Recent changes", () => this._getChanges());
            toolsMenuItem.menu.addAction("Install snap...", () => this._installSnapDialog());

            this._menuSectionTools.addMenuItem(toolsMenuItem);

            // Snaps
            this._menuSectionSnaps = new PopupMenu.PopupMenuSection();
            this._menuSectionSnaps.actor.set_style('padding-right: 16px;');

            this._scrollView.set_child(this._menuSectionSnaps.actor);
            this.menu.box.add_child(this._scrollView);
            this._menuSectionSnaps._getTopMenu = () => this.menu;
        }

        _populateSnapsMenu() {
            this._menuSectionSnaps?.removeAll();
            const allSnapItems = [];

            for (const snap of this._snapsList) {
                const snapMenuItem = new PopupMenu.PopupSubMenuMenuItem(snap?.name ?? 'Unknown');
                this._menuSectionSnaps.addMenuItem(snapMenuItem);
                allSnapItems.push(snapMenuItem);

                snapMenuItem.connectObject('notify::active', () => {
                    if (snapMenuItem.active)
                        allSnapItems.forEach(item => {
                            if (item !== snapMenuItem && item.active)
                                item.setSubmenuShown(false);
                        });
                }, this);

                snapMenuItem.menu.addAction('Details', () => this._showSnapDetails(snap));
                snapMenuItem.menu.addAction('Remove', () => this._removeSnapDialog(snap));
            }
        }

        _updateSnapsMenu() {
            if (this._menuIsUpdating)
                return;

            this._snapdClient?.get_snaps_async(
                Snapd.GetAppsFlags.NONE,
                null,
                null,
                (client, result) => {
                    this._snapsList = client.get_snaps_finish(result);
                    this._snapsList.sort((a, b) => a?.name > b?.name);

                    this._populateSnapsMenu();

                    this._menuIsUpdating = false;
                }
            );
        }

        _refreshSnaps() {
            this._snapdClient?.refresh_all_async(
                null,
                null,
                (client, result) => {
                    try {
                        const refreshedSnaps = client.refresh_all_finish(result);

                        this._showNotification('Snap menu extension :: Refresh', 'Refreshing snaps...');
                        this._showTextDialog(
                            'Snap menu extension :: Refresh',
                            [
                                '<b>Refreshed snaps</b>',
                                `${refreshedSnaps?.join('\n')}`,
                            ]
                        );
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
                        changesList.sort((a, b) => b?.ready_time?.compare(a?.ready_time));
                        const changesLogs = changesList.map(change =>
                            `<b>${change?.ready_time.format('%c')}</b>\u2003${change?.summary}`);
                        this._showTextDialog(
                            'Snap menu extension :: Changes',
                            [changesLogs?.join('\n'),]
                        );
                    } catch (e) {
                        if (e.message && e.message.includes('Unexpected result type')) {
                            this._showNotification('Snap menu extension :: Changes', 'No changes.');
                        } else
                            this._showNotification('Snap menu extension :: Changes', 'Error: ' + e.message);
                    }
                }
            );
        }

        _getSnapConfinementName(snapConfinement) {
            if (!snapConfinement)
                return;

            switch (snapConfinement) {
                case 0:
                    return 'unknown';
                    break;
                case 1:
                    return 'strict';
                    break;
                case 2:
                    return 'devmode (unconfined)';
                    break;
                case 3:
                    return 'classic';
                    break;
            }
        }

        _showSnapDetails(snap) {
            this.menu?.close();

            const title = snap?.title
            const summary = snap?.summary ?? 'N/A';
            const version = snap?.version ?? 'N/A';
            const revision = snap?.revision ?? 'N/A';
            const date = snap?.install_date.format('%c') ?? 'N/A';
            const channel = snap?.channel ?? 'N/A';
            const confinement = this._getSnapConfinementName(snap?.confinement) ?? 'N/A';
            const apps = snap?.get_apps()?.map(app => app?.name).join('\u2003') ?? 'N/A';

            this._showTextDialog(
                'Snap menu extension :: Info',
                [
                    `<b>Name</b>\u2003${title}`,
                    `<b>Summary</b>\u2003${summary}`,
                    '',
                    `<b>Version</b>\u2003${version}\u2003(${revision})`,
                    `<b>Install date</b>\u2003${date}`,
                    '',
                    `<b>Channel</b>\u2003${channel}`,
                    `<b>Confinement</b>\u2003${confinement}`,
                    '',
                    `<b>Apps</b>\u2003${apps}`,
                ]
            )
        }

        _installSnapDialog() {
            const installSnap = () => {
                const snapName = entry?.text?.trim();
                if (!snapName)
                    return;

                dialog.close();
                this._installSnap(snapName);
            };

            const dialog = new ModalDialog.ModalDialog();

            const title = new St.Label({
                text: 'Snap menu extension :: Install snap',
                style: 'font-size: 1.5em; font-weight: bold;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            dialog.contentLayout.add_child(title);

            const entry = new St.Entry({
                can_focus: true,
                hint_text: 'Enter snap name',
            });
            dialog.contentLayout.add_child(entry);
            dialog.setInitialKeyFocus(entry);

            entry?.clutter_text.connectObject('activate', installSnap, this);

            dialog.setButtons([
                {
                    label: 'Cancel',
                    action: () => dialog.close(),
                    key: Clutter.KEY_Escape,
                },
                {
                    label: 'Install',
                    action: installSnap,
                },
            ]);

            dialog.open();
        }

        _installSnap(snapName) {
            this._snapdClient?.install2_async(
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
                style: 'font-size: 1.5em; font-weight: bold;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            dialog.contentLayout.add_child(title);

            const body = new St.Label({
                text: `<b>WARNING</b>\u2003 Really remove snap <b>${snap?.name}</b> ? `,
            });
            body.clutter_text.use_markup = true;
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
            this._snapdClient?.remove_async(
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

            source.addNotification(notification);
        }

        _showTextDialog(title, body) {
            const dialog = new ModalDialog.ModalDialog();

            const titleLabel = new St.Label({
                text: title,
                style: 'font-size: 1.5em; font-weight: bold;',
                x_align: Clutter.ActorAlign.CENTER,
            });

            dialog.contentLayout.add_child(titleLabel);

            let bodyBox = new St.BoxLayout({
                vertical: true,
            });
            dialog.contentLayout.add_child(bodyBox);

            for (const text of body) {
                const label = new St.Label({
                    text: text,
                });
                label.clutter_text.use_markup = true;
                label.clutter_text.line_wrap = true;
                label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
                label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

                bodyBox.add_child(label);
            }

            dialog.setButtons([
                {
                    label: 'Close',
                    action: () => dialog.close(),
                    key: Clutter.KEY_Escape,
                },
            ]);

            dialog.open();
        }

        destroy() {
            this._snapdNoticesMonitor?.disconnectObject(this);
            this._snapdNoticesMonitor?.stop();

            this._snapdNoticesMonitor = null;
            this._snapdClientForMonitoring = null;
            this._snapdClient = null;

            this._menuSectionTools?.removeAll();
            this._menuSectionSnaps?.removeAll();
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
