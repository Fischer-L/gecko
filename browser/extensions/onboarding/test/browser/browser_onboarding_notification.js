/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_show_tour_notifications_in_order() {
  resetOnboardingDefaultState();
  await SpecialPowers.pushPrefEnv({set: [["browser.onboarding.enabled", true]]});
  Preferences.set("browser.onboarding.notification.max-prompt-count-per-tour", 1);
  skipMuteNotificationOnFirstSession();

  let tourIds = TOUR_IDs;
  let tab = null;
  let targetTourId = null;
  let reloadPromise = null;
  let expectedPrefUpdate = null;
  for (let i = 0; i < tourIds.length; ++i) {
    expectedPrefUpdate = promisePrefUpdated("browser.onboarding.notification.last-prompted", tourIds[i]);
    if (tab) {
      reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
      tab.linkedBrowser.reload();
      await reloadPromise;
    } else {
      tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
      await BrowserTestUtils.loadURI(tab.linkedBrowser, ABOUT_NEWTAB_URL);
    }
    await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
    await promiseTourNotificationOpened(tab.linkedBrowser);
    targetTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
    is(targetTourId, tourIds[i], "Should show tour notifications in order");
    await expectedPrefUpdate;
  }

  expectedPrefUpdate = promisePrefUpdated("browser.onboarding.notification.last-prompted", tourIds[0]);
  reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  tab.linkedBrowser.reload();
  await reloadPromise;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  targetTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  is(targetTourId, tourIds[0], "Should loop back to the 1st tour notification after showing all notifications");
  await expectedPrefUpdate;
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_open_target_tour_from_notification() {
  resetOnboardingDefaultState();
  await SpecialPowers.pushPrefEnv({set: [["browser.onboarding.enabled", true]]});
  Preferences.set("browser.onboarding.notification.max-prompt-count-per-tour", 1);
  skipMuteNotificationOnFirstSession();

  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await BrowserTestUtils.loadURI(tab.linkedBrowser, ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  let targetTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  await BrowserTestUtils.synthesizeMouseAtCenter("#onboarding-notification-action-btn", {}, tab.linkedBrowser);
  await promiseOnboardingOverlayOpened(tab.linkedBrowser);
  let { activeNavItemId, activePageId } = await getCurrentActiveTour(tab.linkedBrowser);

  is(targetTourId, activeNavItemId, "Should navigate to the target tour item.");
  is(`${targetTourId}-page`, activePageId, "Should display the target tour page.");
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_not_show_notification_for_completed_tour() {
  resetOnboardingDefaultState();
  await SpecialPowers.pushPrefEnv({set: [["browser.onboarding.enabled", true]]});
  Preferences.set("browser.onboarding.notification.max-prompt-count-per-tour", 1);
  skipMuteNotificationOnFirstSession();

  let tourIds = TOUR_IDs;
  // Make only the last tour uncompleted
  let lastTourId = tourIds[tourIds.length - 1];
  for (let id of tourIds) {
    if (id != lastTourId) {
      setTourCompletedState(id, true);
    }
  }

  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await BrowserTestUtils.loadURI(tab.linkedBrowser, ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  let targetTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  is(targetTourId, lastTourId, "Should not show notification for completed tour");
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_skip_notification_for_completed_tour() {
  resetOnboardingDefaultState();
  await SpecialPowers.pushPrefEnv({set: [["browser.onboarding.enabled", true]]});
  Preferences.set("browser.onboarding.notification.max-prompt-count-per-tour", 1);
  skipMuteNotificationOnFirstSession();

  let tourIds = TOUR_IDs;
  // Make only 2nd tour completed
  await setTourCompletedState(tourIds[1], true);

  // Test show notification for the 1st tour
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await BrowserTestUtils.loadURI(tab.linkedBrowser, ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  let targetTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  is(targetTourId, tourIds[0], "Should show notification for incompleted tour");

  // Test skip the 2nd tour and show notification for the 3rd tour
  let reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  tab.linkedBrowser.reload();
  await reloadPromise;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  targetTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  is(targetTourId, tourIds[2], "Should skip notification for the completed 2nd tour");
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_mute_notification_on_1st_session() {
  resetOnboardingDefaultState();
  await SpecialPowers.pushPrefEnv({set: [["browser.onboarding.enabled", true]]});
  const TEST_MUTE_DURATION = 2000;
  Preferences.set("browser.onboarding.notification.mute-duration-on-first-session-ms", TEST_MUTE_DURATION);

  // Test no notifications during the mute duration on the 1st session
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await BrowserTestUtils.loadURI(tab.linkedBrowser, ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  // The tour notification would be prompted on idle, so we wait idle twice here before proceeding
  await waitUntilWindowIdle(tab.linkedBrowser);
  await waitUntilWindowIdle(tab.linkedBrowser);
  let reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  tab.linkedBrowser.reload();
  await reloadPromise;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await waitUntilWindowIdle(tab.linkedBrowser);
  await waitUntilWindowIdle(tab.linkedBrowser);
  let promptCount = Preferences.get("browser.onboarding.notification.prompt-count");
  is(0, promptCount, "Should not prompt tour notification during the mute duration on the 1st session");

  // Test notification prompted after the mute duration on the 1st session
  await new Promise(resolve => setTimeout(resolve, TEST_MUTE_DURATION + 1));
  reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  tab.linkedBrowser.reload();
  await reloadPromise;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  promptCount = Preferences.get("browser.onboarding.notification.prompt-count");
  is(1, promptCount, "Should prompt tour notification after the mute duration on the 1st session");
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_move_on_to_next_notification_when_reaching_max_prompt_count() {
  resetOnboardingDefaultState();
  await SpecialPowers.pushPrefEnv({set: [["browser.onboarding.enabled", true]]});
  skipMuteNotificationOnFirstSession();
  let maxCount = Preferences.get("browser.onboarding.notification.max-prompt-count-per-tour");

  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await BrowserTestUtils.loadURI(tab.linkedBrowser, ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  let previousTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);

  let currentTourId = null;
  let reloadPromise = null;
  for (let i = maxCount - 1; i > 0; --i) {
    reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
    tab.linkedBrowser.reload();
    await reloadPromise;
    await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
    await promiseTourNotificationOpened(tab.linkedBrowser);
    currentTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
    is(previousTourId, currentTourId, "Should not move on to next tour notification until reaching the max prompt count per tour");
  }

  reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  tab.linkedBrowser.reload();
  await reloadPromise;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  currentTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  isnot(previousTourId, currentTourId, "Should move on to next tour notification when reaching the max prompt count per tour");

  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_move_on_to_next_notification_when_reaching_max_life_time() {
  resetOnboardingDefaultState();
  await SpecialPowers.pushPrefEnv({set: [["browser.onboarding.enabled", true]]});
  skipMuteNotificationOnFirstSession();
  const TEST_MAX_LIFE_TIME = 2000;
  Preferences.set("browser.onboarding.notification.max-life-time-per-tour-ms", TEST_MAX_LIFE_TIME);

  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await BrowserTestUtils.loadURI(tab.linkedBrowser, ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  let previousTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);

  await new Promise(resolve => setTimeout(resolve, TEST_MAX_LIFE_TIME + 1));
  let reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  tab.linkedBrowser.reload();
  await reloadPromise;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  let currentTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  isnot(previousTourId, currentTourId, "Should move on to next tour notification when reaching the max life time per tour");

  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_move_on_to_next_notification_after_interacting_with_notification() {
  resetOnboardingDefaultState();
  await SpecialPowers.pushPrefEnv({set: [["browser.onboarding.enabled", true]]});
  skipMuteNotificationOnFirstSession();

  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await BrowserTestUtils.loadURI(tab.linkedBrowser, ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  let previousTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  await BrowserTestUtils.synthesizeMouseAtCenter("#onboarding-notification-close-btn", {}, tab.linkedBrowser);

  let reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  tab.linkedBrowser.reload();
  await reloadPromise;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  let currentTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  isnot(previousTourId, currentTourId, "Should move on to next tour notification after clicking #onboarding-notification-close-btn");
  await BrowserTestUtils.synthesizeMouseAtCenter("#onboarding-notification-action-btn", {}, tab.linkedBrowser);
  previousTourId = currentTourId;

  reloadPromise = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  tab.linkedBrowser.reload();
  await reloadPromise;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  currentTourId = await getCurrentNotificationTargetTourId(tab.linkedBrowser);
  isnot(previousTourId, currentTourId, "Should move on to next tour notification after clicking #onboarding-notification-action-btn");

  await BrowserTestUtils.removeTab(tab);
});
