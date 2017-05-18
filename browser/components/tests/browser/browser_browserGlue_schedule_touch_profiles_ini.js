"use strict"

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

add_task(function* test_schedule_touch_profiles_ini() {
  let BrowserGlue = Cc["@mozilla.org/browser/browserglue;1"]
                      .getService(Ci.nsIBrowserGlue).wrappedJSObject;

  // Clean the old schedule if there was
  if (BrowserGlue._touchProfilesIniDeferredTask) {
    BrowserGlue._touchProfilesIniDeferredTask.disarm();
    BrowserGlue._touchProfilesIniDeferredTask = null;
  }

  let ini = BrowserGlue._getProfilesIni();
  if (!ini.exists()) {
    // In some test environment, there might not be the profiles.ini.
    // Create one profile to make one profiles.ini for that case.
    let profileService = Components.classes["@mozilla.org/toolkit/profile-service;1"]
                                   .getService(Components.interfaces.nsIToolkitProfileService);
    profileService.createProfile(null, "justOneTestProfile");
    profileService.flush();
    ini = BrowserGlue._getProfilesIni();
  }
  let oldModifiedTime = ini.lastModifiedTime;

  const TEST_NEXT_TOUCH_IN_MS = 2000;
  BrowserGlue._scheduleTouchProfilesIni(TEST_NEXT_TOUCH_IN_MS);

  const TRY_INTERVAL = 100;
  let checkProfilesIniTouched = () => {
    // Always get the ini again to make sure holding the updated file handle.
    // If not, in the Windows test environment, would fail.
    return BrowserGlue._getProfilesIni().lastModifiedTime > oldModifiedTime;
  };
  yield BrowserTestUtils.waitForCondition(
    checkProfilesIniTouched,
    "Check if the profiles.ini is touched",
    TRY_INTERVAL,
    TEST_NEXT_TOUCH_IN_MS * 2 / TRY_INTERVAL
  );
  ok(true, "Should touch the profiles.ini on schedule");
});
