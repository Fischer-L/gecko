"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "OfflineAppCacheHelper",
                                  "resource:///modules/offlineAppCache.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "ContextualIdentityService",
                                  "resource://gre/modules/ContextualIdentityService.jsm");

this.EXPORTED_SYMBOLS = [
  "SiteDataManager"
];

this.SiteDataManager = {

  _qms: Services.qms,

  _diskCache: Services.cache2.diskCacheStorage(Services.loadContextInfo.default, false),

  _appCache: Cc["@mozilla.org/network/application-cache-service;1"].getService(Ci.nsIApplicationCacheService),

  // A Map of sites and their disk usage according to Quota Manager
  // Key is site's origin.
  // Value is one object holding:
  //   - principal: instance of nsIPrincipal
  //   - status: the permission granted/rejected status
  //   - quotaUsage: the usage of indexedDB and localStorage.
  //   - appCacheList: an array of app cache; instances of nsIApplicationCache
  //   - diskCacheList: an array. Each element is object holding metadata of http cache:
  //       - uri: the uri of that http cache
  //       - dataSize: that http cache size
  //       - idEnhance: the id extension of that http cache
  _sites: new Map(),

  _getQuotaUsagePromise: null,

  _updateDiskCachePromise: null,

  _quotaUsageRequest: null,

  updateSites() {
    // Clear old data and requests first
    this._sites.clear();
    this._cancelGetQuotaUsage();

    this._getQuotaUsage()
        .then(results => {
          for (let site of results) {
            let principal =
              Services.scriptSecurityManager.createCodebasePrincipalFromOrigin(site.origin);
            let status = site.persisted ?
              Ci.nsIPermissionManager.ALLOW_ACTION : Ci.nsIPermissionManager.DENY_ACTION;
            this._sites.set(principal.URI.spec, {
              principal,
              status,
              quotaUsage: site.usage,
              appCacheList: [],
              diskCacheList: []
            });
          }
          this._updateAppCache();
          return this._updateDiskCache();
        }).then(() => {
          Services.obs.notifyObservers(null, "sitedatamanager:sites-updated", null);
        });
  },

  _getQuotaUsage() {
    this._getQuotaUsagePromise = new Promise(resolve => {
      let callback = {
        onUsageResult(request) {
          resolve(request.result);
        }
      };
      // XXX: The work of integrating localStorage into Quota Manager is in progress.
      //      After the bug 742822 and 1286798 landed, localStorage usage will be included.
      //      So currently only get indexedDB usage.
      this._quotaUsageRequest = this._qms.getUsage(callback);
    });
    return this._getQuotaUsagePromise;
  },

  _cancelGetQuotaUsage() {
    if (this._quotaUsageRequest) {
      this._quotaUsageRequest.cancel();
      this._quotaUsageRequest = null;
    }
  },

  _updateAppCache() {
    let groups = this._appCache.getGroups();
    for (let site of this._sites.values()) {
      for (let group of groups) {
        let uri = Services.io.newURI(group);
        if (site.principal.URI.host === uri.host) {
          let cache = this._appCache.getActiveCache(group);
          site.appCacheList.push(cache);
        }
      }
    }
  },

  _updateDiskCache() {
    this._updateDiskCachePromise = new Promise(resolve => {
      if (this._sites.size) {
        let sites = this._sites;
        let visitor = {
          onCacheEntryInfo(uri, idEnhance, dataSize) {
            for (let site of sites.values()) {
              if (site.principal.URI.host === uri.host) {
                site.diskCacheList.push({
                  uri,
                  dataSize,
                  idEnhance
                });
                break;
              }
            }
          },
          onCacheEntryVisitCompleted() {
            resolve();
          }
        };
        this._diskCache.asyncVisitStorage(visitor, true);
      } else {
        resolve();
      }
    });
    return this._updateDiskCachePromise;
  },

  getTotalUsage() {
    return Promise.all([this._getQuotaUsagePromise, this._updateDiskCachePromise])
                  .then(() => {
                    let usage = 0;
                    for (let site of this._sites.values()) {
                      let cache = null;
                      for (cache of site.appCacheList) {
                        usage += cache.usage;
                      }
                      for (cache of site.diskCacheList) {
                        usage += cache.dataSize;
                      }
                      usage += site.quotaUsage;
                    }
                    return usage;
                  });
  },

  getSites() {
    return Promise.all([this._getQuotaUsagePromise, this._updateDiskCachePromise])
                  .then(() => {
                    let list = [];
                    for (let [origin, site] of this._sites) {
                      let cache = null;
                      let usage = site.quotaUsage;
                      for (cache of site.appCacheList) {
                        usage += cache.usage;
                      }
                      for (cache of site.diskCacheList) {
                        usage += cache.dataSize;
                      }
                      list.push({
                        usage,
                        status: site.status,
                        uri: Services.io.newURI(origin)
                      });
                    }
                    return list;
                  });
  },

  _removePermission(site) {
    Services.perms.remove(site.principal.URI, "persistent-storage");
  },

  _removeQuotaUsage(site) {
    return new Promise(resolve => {
      let request = this._qms.clearStoragesForPrincipal(site.principal, null, false);
      request.callback = () => resolve();
    });
  },

  _removeDiskCache(site) {
    for (let cache of site.diskCacheList) {
      this._diskCache.asyncDoomURI(cache.uri, cache.idEnhance, null);
    }
  },

  _removeAppCache(site) {
    for (let cache of site.appCacheList) {
      cache.discard();
    }
  },

  _removeCookie(site) {
    let host = site.principal.URI.host;
    let e = Services.cookies.getCookiesFromHost(host, {});
    while (e.hasMoreElements()) {
      let cookie = e.getNext();
      if (cookie instanceof Components.interfaces.nsICookie) {
        if (this.isPrivateCookie(cookie)) {
          continue;
        }
        Services.cookies.remove(
          cookie.host, cookie.name, cookie.path, false, cookie.originAttributes);
      }
    }
  },

  remove(uris) {
    let promises = [];
    for (let uri of uris) {
      let site = this._sites.get(uri.spec);
      if (site) {
        this._removePermission(site);
        this._removeDiskCache(site);
        this._removeAppCache(site);
        this._removeCookie(site);
        promises.push(this._removeQuotaUsage(site));
      }
    }
    Promise.all(promises).then(() => this.updateSites());
  },

  removeAll() {
    let promises = [];
    for (let site of this._sites.values()) {
      this._removePermission(site);
      promises.push(this._removeQuotaUsage(site));
    }
    Services.cache2.clear();
    Services.cookies.removeAll();
    OfflineAppCacheHelper.clear();
    Promise.all(promises).then(() => this.updateSites());
  },

  isPrivateCookie(cookie) {
    let { userContextId } = cookie.originAttributes;
    // A private cookie is when its userContextId points to a private identity.
    return userContextId && !ContextualIdentityService.getPublicIdentityFromId(userContextId);
  }
};




(In reply to :Gijs from comment #3)
> Comment on attachment 8852806
> Bug 1348733 - List sites using quota storage in Settings of Site Data
>
> https://reviewboard.mozilla.org/r/124966/#review127624
> > +  // A Map of sites using usage in Quota Manager
>
> English nit: "A Map of sites and their disk usage according to Quota
> Manager".
Thanks, updated.

> ::: browser/components/preferences/SiteDataManager.jsm:52
> (Diff revision 1)
> > -    let e = Services.perms.enumerator;
> > -    while (e.hasMoreElements()) {
> > +            let principal = Services.scriptSecurityManager.createCodebasePrincipal(
> > +              Services.io.newURI(site.origin), {});
>
> Why are we creating principals from the origins?
>
> Also, does this mean storage is shared between 2 instances of an origin with
> different origin attributes? Because that would be Bad. If you don't know,
> can you check with Jan?
>
Checked with the DOM team, underlying, no. Differernt origin attributes mean differernt storages.
The `getUsage` api of QuotaManager would return origin with origin attribute as well, for example, https://www.foo.com^userContextId=2.
Here also update to `let principal = Services.scriptSecurityManager.createCodebasePrincipalFromOrigin(site.origin);`. So we are mkaing sure creating specific principal for specific origin including origin attribute.

> If it's just summing up usage between different OA for the same origin, that
> should be fine, but even then we really don't need to create principals for
> our internal maps. Just the URI is enough.



> I only see us using a principal to remove data for an origin, but that mismatch (we got usage for a string
> origin, not for that specific principal) seems concerning.
>


> Another question: will it be possible for there to be 2 quota results for
> the same origin, one for persistent usage and one for non-persistent usage?
> If so, this won't currently work with the code as-is as the keys in the map
> will be the same (so we'll overwrite part of the data in the map and not
> display its usage in the treeview).
>
No. One origin only can have one status, persistent or not persistent.

> :::
> browser/components/preferences/in-content-old/tests/browser_advanced_siteData.js:121 (Diff revision 1)
> >  function addPersistentStoragePerm(origin) {
>
> Quite some, but not all, of the callsites of this were removed. Can you
> elaborate on why that was the case?
This is because right now we switch to Quota Manager for getting sites to display, not getting from Permission Manager any more. However, some old test cases get sites and do tests on UI by only adding some fake origins into Permission Manager as fake test data. That old test approach is no longer applicable so we remove it and take the mockSiteDataManager as the fake test data source.
