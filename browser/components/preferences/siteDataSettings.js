/* -*- indent-tabs-mode: nil; js-indent-level: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
const { interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "SiteDataManager",
                                  "resource:///modules/SiteDataManager.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "DownloadUtils",
                                  "resource://gre/modules/DownloadUtils.jsm");

"use strict";

let gSiteDataSettings = {

  // Array of meatdata of sites. Each array element is object holding:
  // - uri: uri of site; instance of nsIURI
  // - status: persistent-storage permission status
  // - usage: disk usage which site uses
  // - userAction: "remove" or "update-permission"; the action user wants to take.
  //               If not specified, means no action to take
  _sites: null,

  _list: null,

  init() {
    function setEventListener(id, eventType, callback) {
      document.getElementById(id)
              .addEventListener(eventType, callback.bind(gSiteDataSettings));
    }

    this._list = document.getElementById("sitesList");
    SiteDataManager.getSites().then(sites => {
      this._sites = sites;
      let sortCol = document.getElementById("hostCol");
      this._sortSites(this._sites, sortCol);
      this._buildSitesList(this._sites);
      this._updateButtonsState();
      Services.obs.notifyObservers(null, "sitedata-settings-init", null);
    });

    setEventListener("hostCol", "click", this.onClickTreeCol);
    setEventListener("usageCol", "click", this.onClickTreeCol);
    setEventListener("statusCol", "click", this.onClickTreeCol);
    setEventListener("sitesList", "selectSiteItem", this.onSelectSiteItem);
    setEventListener("removeSelected", "command", this.removeSelected);
    setEventListener("save", "command", this.saveChanges);
    setEventListener("cancel", "command", this.close);
  },

  /**
   * @param sites {Array}
   * @param col {XULElement} the <treecol> being sorted on
   */
  _sortSites(sites, col) {
    let isCurrentSortCol = col.getAttribute("data-isCurrentSortCol")
    let sortDirection = col.getAttribute("data-last-sortDirection") || "ascending";
    if (isCurrentSortCol) {
      // Sort on the current column, flip the sorting direction
      sortDirection = sortDirection === "ascending" ? "descending" : "ascending";
    }

    let sortFunc = null;
    switch (col.id) {
      case "hostCol":
        sortFunc = (a, b) => {
          let aHost = a.uri.host.toLowerCase();
          let bHost = b.uri.host.toLowerCase();
          return aHost.localeCompare(bHost);
        }
        break;

      case "statusCol":
        sortFunc = (a, b) => a.status - b.status;
        break;

      case "usageCol":
        sortFunc = (a, b) => a.usage - b.usage;
        break;
    }
    if (sortDirection === "descending") {
      sites.sort((a, b) => sortFunc(b, a));
    } else {
      sites.sort(sortFunc);
    }

    let cols = this._list.querySelectorAll("treecol");
    cols.forEach(c => {
      c.removeAttribute("sortDirection");
      c.removeAttribute("data-isCurrentSortCol");
    });
    col.setAttribute("data-isCurrentSortCol", true);
    col.setAttribute("sortDirection", sortDirection);
    col.setAttribute("data-last-sortDirection", sortDirection);
  },

  _buildSitesList(sites) {
    // Clear old entries.
    while (this._list.childNodes.length > 1) {
      this._list.removeChild(this._list.lastChild);
    }

    let prefStrBundle = document.getElementById("bundlePreferences");
    for (let data of sites) {
      if (data.userAction === "remove") {
        continue;
      }
      let statusStrId = data.status === Ci.nsIPermissionManager.ALLOW_ACTION ? "important" : "default";
      let size = DownloadUtils.convertByteUnits(data.usage);
      let item = document.createElement("richlistitem");
      item.setAttribute("data-origin", data.uri.spec);
      item.setAttribute("host", data.uri.host);
      item.setAttribute("status", prefStrBundle.getString(statusStrId));
      item.setAttribute("usage", prefStrBundle.getFormattedString("siteUsage", size));
      this._list.appendChild(item);
    }
  },

  _getSiteByOrigin(origin) {
    return this._sites.find(site => site.uri.spec == origin);
  },

  onSelectSiteItem() {
    // On site item selected, status menu would appear.
    // Let's set up the right permission status for status menu
    let selectedItem = this._list.selectedItem;
    let site = this._getSiteByOrigin(selectedItem.getAttribute("data-origin"));
    let menuList = document.getAnonymousElementByAttribute(selectedItem, "class", "menu-list");
    menuList.selectedIndex = site.status === Ci.nsIPermissionManager.ALLOW_ACTION ? 0 : 1;
  },

  onSelectStatusMenuItem(menuItem) {
    let statusStrId = "";
    let newStatus = null;
    let selectedItem = this._list.selectedItem;
    let site = this._getSiteByOrigin(selectedItem.getAttribute("data-origin"));

    if (menuItem.value == "persistent") {
      statusStrId = "important";
      newStatus = Ci.nsIPermissionManager.ALLOW_ACTION;
    } else {
      statusStrId = "default";
      newStatus = Ci.nsIPermissionManager.DENY_ACTION;
    }
    if (site.status != newStatus) {
      site.status = newStatus;
      site.userAction = "update-permission";
      let prefStrBundle = document.getElementById("bundlePreferences");
      selectedItem.setAttribute("status", prefStrBundle.getString(statusStrId));
    }
  },

  onClickTreeCol(e) {
    this._sortSites(this._sites, e.target);
    this._buildSitesList(this._sites);
  },

  _updateButtonsState() {
    let items = this._list.getElementsByTagName("richlistitem");
    let removeBtn = document.getElementById("removeSelected");
    removeBtn.disabled = !(items.length > 0);
  },

  removeSelected() {
    let selected = this._list.selectedItem;
    if (selected) {
      let origin = selected.getAttribute("data-origin");
      for (let site of this._sites) {
        if (site.uri.spec === origin) {
          site.userAction = "remove";
          break;
        }
      }
      this._list.removeChild(selected);
      this._updateButtonsState();
    }
  },

  saveChanges() {
    let allowed = true;

    let removeds = [];
    let statusUpdates = [];
    this._sites = this._sites.filter(site => {
      if (site.userAction === "update-permission") {
        statusUpdates.push([site.uri, site.status]);
      } else if (site.userAction === "remove") {
        removeds.push(site.uri);
        return false;
      }
      return true;
    });

    // Confirm user really wants to remove site data starts
    if (removeds.length > 0) {
      if (this._sites.length == 0) {
        // User selects all site so equivalent to clearing all data
        let flags =
          Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 +
          Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1 +
          Services.prompt.BUTTON_POS_0_DEFAULT;
        let prefStrBundle = document.getElementById("bundlePreferences");
        let title = prefStrBundle.getString("clearSiteDataPromptTitle");
        let text = prefStrBundle.getString("clearSiteDataPromptText");
        let btn0Label = prefStrBundle.getString("clearSiteDataNow");
        let result = Services.prompt.confirmEx(window, title, text, flags, btn0Label, null, null, null, {});
        allowed = result == 0;
        if (allowed) {
          SiteDataManager.removeAll();
        }
      } else {
        // User only removes partial sites.
        // We will remove cookies based on base domain, say, user selects "news.foo.com" to remove.
        // The cookies under "music.foo.com" will be removed together.
        // We have to prmopt user about this action.
        let hostsTable = new Map();
        // Group removed sites by base domain
        for (let uri of removeds) {
          let baseDomain = Services.eTLD.getBaseDomain(uri);
          let hosts = hostsTable.get(baseDomain);
          if (!hosts) {
            hosts = [];
            hostsTable.set(baseDomain, hosts);
          }
          hosts.push(uri.host);
        }
        // Pick out sites with the same base domain as removed sites
        for (let site of this._sites) {
          let baseDomain = Services.eTLD.getBaseDomain(site.uri);
          let hosts = hostsTable.get(baseDomain);
          if (hosts) {
            hosts.push(site.uri.host);
          }
        }

        let args = {
          hostsTable,
          allowed: false
        };
        let features = "centerscreen,chrome,modal,resizable=no";
        window.openDialog("chrome://browser/content/preferences/siteDataRemoveSelected.xul", "", features, args);
        allowed = args.allowed;
        if (allowed) {
          SiteDataManager.remove(removeds);
        }
      }
    }
    // Confirm user really wants to remove site data ends

    // Update permission status
    if (allowed && statusUpdates.length > 0) {
      // No more confimation prompt here.
      // This is because unlike removal operation which deletes data, user can update status anytime.
      SiteDataManager.setPermissionStatus(statusUpdates);
    }

    this.close();
  },

  close() {
    window.close();
  }
};
