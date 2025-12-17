//    Snap Menu
//    GNOME Shell extension
//    @fthx 2025


import GObject from 'gi://GObject';
import Snapd from 'gi://Snapd';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';


const SNAP_ICON_NAME = 'snap-symbolic';

const SnapMenuButton = GObject.registerClass(
    class SnapMenuButton extends PanelMenu.Button {
        _init() {
            super._init(0.5);

            this._snapdClient = new Snapd.Client();
            this._snapdNoticesMonitor = Snapd.NoticesMonitor.new_with_client(this._snapdClient);
            this._snapdNoticesMonitor?.start();

            this._makeButtonBox();
            this._updateMenu();

            this._snapdNoticesMonitor?.connectObject('notice-event', () => this._updateMenu(), this);
        }

        _makeButtonBox() {
            this._box = new St.BoxLayout();

            this._icon = new St.Icon({ icon_name: SNAP_ICON_NAME, style_class: 'system-status-icon' });
            this._box.add_child(this._icon);

            this.add_child(this._box);
        }

        _populateMenu() {
            this.menu?.removeAll();

            const toolsMenuItem = new PopupMenu.PopupSubMenuMenuItem("Tools");
            this.menu.addMenuItem(toolsMenuItem);

            toolsMenuItem.menu.addAction("Refresh snaps", () => this._refreshSnaps());
            toolsMenuItem.menu.addAction("Recent changes", () => this._getChanges());

            const snapsMenuItem = new PopupMenu.PopupSubMenuMenuItem("Installed snaps");
            this.menu.addMenuItem(snapsMenuItem);

            for (const snap of this._snapsList) {
                const snapItem = new PopupMenu.PopupMenuItem(snap?.name);
                snapsMenuItem.menu.addMenuItem(snapItem);
            }
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
                        const refreshedSnaps = client.refresh_all_finish(result)?.join(' ');
                        Main.notify('Snap menu extension: refresh', `Refreshed snaps: ${refreshedSnaps}.`);
                    } catch (e) {
                        if (e.message && e.message.includes('Unexpected result type')) {
                            Main.notify('Snap menu extension: refresh', 'No refresh found.');
                        } else
                            Main.notify('Snap menu extension: refresh', 'Error: ' + e.message);
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
                        Main.notify('Snap menu extension: changes', summaries.join('\n'));
                    } catch (e) {
                        if (e.message && e.message.includes('Unexpected result type')) {
                            Main.notify('Snap menu extension: changes', 'No changes.');
                        } else
                            Main.notify('Snap menu extension: changes', 'Error: ' + e.message);
                    }
                }
            );
        }

        destroy() {
            this._snapdNoticesMonitor.disconnectObject(this);
            this._snapdNoticesMonitor.stop();

            this._snapdNoticesMonitor = null;
            this._snapdClient = null;

            this.menu?.removeAll();

            super.destroy();
        }
    });

export default class SnapMenuExtension {
    enable() {
        this._snapMenuButton = new SnapMenuButton();

        if (!Main.panel.statusArea['Snap Menu Button'])
            Main.panel.addToStatusArea('Snap Menu Button', this._snapMenuButton);
    }

    disable() {
        this._snapMenuButton?.destroy();
        this._snapMenuButton = null;
    }
}
