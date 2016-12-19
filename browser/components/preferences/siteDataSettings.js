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
  // - userAction: "remove" or "switch-permission"; the action user wants to take.
  //               If not specified, means no action to take
  _sites: null,

  _list: null,

  init() {
    function setEventListener(id, eventType, callback){
      document.getElementById(id)
              .addEventListener(eventType, callback.bind(gSiteDataSettings));
    }

    this._list = document.getElementById("sitesList");
    SiteDataManager.getSites().then(sites => {
      this._sites = sites;
      this._sortSites(this._sites, "decending");
      this._buildSitesList(this._sites);
    });

    setEventListener("removeSelected", "command", this.removeSelected);
    setEventListener("save", "command", this.saveChanges);
    setEventListener("cancel", "command", this.close);
  },

  uninit() {

  },

  /**
   * Sort sites by usages
   *
   * @param sites {Array}
   * @param order {String} indicate to sort in the "decending" or "ascending" order
   */
  _sortSites(sites, order) {
    sites.sort((a, b) => {
      if (order === "ascending") {
        return a.usage - b.usage;
      }
      return b.usage - a.usage;
    });
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

  removeSelected() {
    let selected = this._list.selectedItem;
    if (selected) {
      this._list.removeChild(selected);
      let origin = selected.getAttribute("data-origin");
      for (let site of this._sites) {
        if (site.uri.spec === origin) {
          site.userAction = "remove";
          break;
        }
      }
    }
  },

  saveChanges() {
// TMP To Del
let args = {
  allowed: false,
  sitesTable: new Map([
    [
      "aaa.com", [ "new.aaa.com", "music.aaa.com", "shopping.aaa.com" ]
    ],
    [
      "bbb.com", [ "tw.bbb.com", "jp.bbb.com", "us.bbb.com" ]
    ]
  ])
};
let features = "centerscreen,chrome,modal,resizable=no";
window.openDialog("chrome://browser/content/preferences/siteDataRemoveSelected.xul", "", features, args);
console.log(args.allowed);
return;

    let allowed = true;

    // Confirm user really wants to remove site data
    let removeds = [];
    this._sites = this._sites.filter(site => {
      if (site.userAction === "remove") {
        removeds.push(site);
        return false;
      }
      return true;
    });

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
        let sitesTable = new Map();
        // Group removed sites by base domain
        for (let site of removeds) {
          let baseDomain = Services.eTLD.getBaseDomain(site.uri);
          let hosts = sitesTable.get(baseDomain);
          if (!hosts) {
            hosts = [];
            sitesTable.set(baseDomain, hosts);
          }
          hosts.push(site.uri.host);
        }
        // Pick out sites with the same base domain as removed sites
        for (let site of this._sites) {
          let baseDomain = Services.eTLD.getBaseDomain(site.uri);
          let hosts = sitesTable.get(baseDomain);
          if (hosts) {
            hosts.push(site.uri.host);
          }
        }

        let args = {
          sitesTable,
          allowed: false
        };
        let features = "centerscreen,chrome,modal,resizable=no";
        window.openDialog("chrome://browser/content/preferences/siteDataRemoveSelected.xul", "", features, args);
        allowed = args.allowed;
        if (allowed) {
          for (let site of removeds) {
            SiteDataManager.remove(site.uri.spec);
          }
        }
      }
    }
  },

  close() {
// TMP To Del
let flags =
  Services.prompt.BUTTON_TITLE_OK * Services.prompt.BUTTON_POS_0 +
  Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1 +
  Services.prompt.BUTTON_POS_0_DEFAULT;
let title = "Removeing site data";
let text = "Removing site data will also remove cookies. This may log you out of websites and remove offline web content. Are you sure you wnat to make the changes?";

let result = Services.prompt.confirmEx(
  window, title, text, flags, null, null, null, null, {});
return;

    window.close();
  }
};
