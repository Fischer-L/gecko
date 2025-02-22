/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = [ "SitePermissions" ];

Components.utils.import("resource://gre/modules/Services.jsm");

var gStringBundle =
  Services.strings.createBundle("chrome://browser/locale/sitePermissions.properties");

this.SitePermissions = {

  UNKNOWN: Services.perms.UNKNOWN_ACTION,
  ALLOW: Services.perms.ALLOW_ACTION,
  BLOCK: Services.perms.DENY_ACTION,
  SESSION: Components.interfaces.nsICookiePermission.ACCESS_SESSION,

  /* Returns a list of objects representing all permissions that are currently
   * set for the given URI. Each object contains the following keys:
   * - id: the permissionID of the permission
   * - label: the localized label
   * - state: a constant representing the current permission state
   *   (e.g. SitePermissions.ALLOW)
   * - availableStates: an array of all available states for that permission,
   *   represented as objects with the keys:
   *   - id: the state constant
   *   - label: the translated label of that state
   */
  getPermissionsByURI: function (aURI) {
    if (!this.isSupportedURI(aURI)) {
      return [];
    }

    let permissions = [];
    for (let permission of kPermissionIDs) {
      let state = this.get(aURI, permission);
      if (state === this.UNKNOWN) {
        continue;
      }

      let availableStates = this.getAvailableStates(permission).map( state => {
        return { id: state, label: this.getStateLabel(permission, state) };
      });
      let label = this.getPermissionLabel(permission);

      permissions.push({
        id: permission,
        label: label,
        state: state,
        availableStates: availableStates,
      });
    }

    return permissions;
  },

  /* Returns a boolean indicating whether there are any granted
   * (meaning allowed or session-allowed) permissions for the given URI.
   * Will return false for invalid URIs (such as file:// URLs).
   */
  hasGrantedPermissions: function (aURI) {
    if (!this.isSupportedURI(aURI)) {
      return false;
    }

    for (let permission of kPermissionIDs) {
      let state = this.get(aURI, permission);
      if (state === this.ALLOW || state === this.SESSION) {
        return true;
      }
    }
    return false;
  },

  /* Checks whether a UI for managing permissions should be exposed for a given
   * URI. This excludes file URIs, for instance, as they don't have a host,
   * even though nsIPermissionManager can still handle them.
   */
  isSupportedURI: function (aURI) {
    return aURI.schemeIs("http") || aURI.schemeIs("https");
  },

  /* Returns an array of all permission IDs.
   */
  listPermissions: function () {
    return kPermissionIDs;
  },

  /* Returns an array of permission states to be exposed to the user for a
   * permission with the given ID.
   */
  getAvailableStates: function (aPermissionID) {
    if (aPermissionID in gPermissionObject &&
        gPermissionObject[aPermissionID].states)
      return gPermissionObject[aPermissionID].states;

    if (this.getDefault(aPermissionID) == this.UNKNOWN)
      return [ SitePermissions.UNKNOWN, SitePermissions.ALLOW, SitePermissions.BLOCK ];

    return [ SitePermissions.ALLOW, SitePermissions.BLOCK ];
  },

  /* Returns the default state of a particular permission.
   */
  getDefault: function (aPermissionID) {
    if (aPermissionID in gPermissionObject &&
        gPermissionObject[aPermissionID].getDefault)
      return gPermissionObject[aPermissionID].getDefault();

    return this.UNKNOWN;
  },

  /* Returns the state of a particular permission for a given URI.
   */
  get: function (aURI, aPermissionID) {
    if (!this.isSupportedURI(aURI))
      return this.UNKNOWN;

    let state;
    if (aPermissionID in gPermissionObject &&
        gPermissionObject[aPermissionID].exactHostMatch)
      state = Services.perms.testExactPermission(aURI, aPermissionID);
    else
      state = Services.perms.testPermission(aURI, aPermissionID);
    return state;
  },

  /* Sets the state of a particular permission for a given URI.
   */
  set: function (aURI, aPermissionID, aState) {
    if (!this.isSupportedURI(aURI))
      return;

    if (aState == this.UNKNOWN) {
      this.remove(aURI, aPermissionID);
      return;
    }

    Services.perms.add(aURI, aPermissionID, aState);
  },

  /* Removes the saved state of a particular permission for a given URI.
   */
  remove: function (aURI, aPermissionID) {
    if (!this.isSupportedURI(aURI))
      return;

    Services.perms.remove(aURI, aPermissionID);
  },

  /* Returns the localized label for the permission with the given ID, to be
   * used in a UI for managing permissions.
   */
  getPermissionLabel: function (aPermissionID) {
    let labelID = gPermissionObject[aPermissionID].labelID || aPermissionID;
    return gStringBundle.GetStringFromName("permission." + labelID + ".label");
  },

  /* Returns the localized label for the given permission state, to be used in
   * a UI for managing permissions.
   */
  getStateLabel: function (aPermissionID, aState) {
    switch (aState) {
      case this.UNKNOWN:
        return gStringBundle.GetStringFromName("alwaysAsk");
      case this.ALLOW:
        return gStringBundle.GetStringFromName("allow");
      case this.SESSION:
        return gStringBundle.GetStringFromName("allowForSession");
      case this.BLOCK:
        return gStringBundle.GetStringFromName("block");
      default:
        throw new Error("unknown permission state");
    }
  }
};

var gPermissionObject = {
  /* Holds permission ID => options pairs.
   *
   * Supported options:
   *
   *  - exactHostMatch
   *    Allows sub domains to have their own permissions.
   *    Defaults to false.
   *
   *  - getDefault
   *    Called to get the permission's default state.
   *    Defaults to UNKNOWN, indicating that the user will be asked each time
   *    a page asks for that permissions.
   *
   *  - labelID
   *    Use the given ID instead of the permission name for looking up strings.
   *    e.g. "desktop-notification2" to use permission.desktop-notification2.label
   *
   *  - states
   *    Array of permission states to be exposed to the user.
   *    Defaults to ALLOW, BLOCK and the default state (see getDefault).
   */

  "image": {
    getDefault: function () {
      return Services.prefs.getIntPref("permissions.default.image") == 2 ?
               SitePermissions.BLOCK : SitePermissions.ALLOW;
    }
  },

  "cookie": {
    states: [ SitePermissions.ALLOW, SitePermissions.SESSION, SitePermissions.BLOCK ],
    getDefault: function () {
      if (Services.prefs.getIntPref("network.cookie.cookieBehavior") == 2)
        return SitePermissions.BLOCK;

      if (Services.prefs.getIntPref("network.cookie.lifetimePolicy") == 2)
        return SitePermissions.SESSION;

      return SitePermissions.ALLOW;
    }
  },

  "desktop-notification": {
    exactHostMatch: true,
    labelID: "desktop-notification2",
  },

  "camera": {},
  "microphone": {},

  "popup": {
    getDefault: function () {
      return Services.prefs.getBoolPref("dom.disable_open_during_load") ?
               SitePermissions.BLOCK : SitePermissions.ALLOW;
    }
  },

  "install": {
    getDefault: function () {
      return Services.prefs.getBoolPref("xpinstall.whitelist.required") ?
               SitePermissions.BLOCK : SitePermissions.ALLOW;
    }
  },

  "geo": {
    exactHostMatch: true
  },

  "indexedDB": {},

  "pointerLock": {
    exactHostMatch: true
  }
};

const kPermissionIDs = Object.keys(gPermissionObject);
