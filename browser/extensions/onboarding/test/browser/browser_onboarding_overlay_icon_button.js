/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const SPEECH_BUBBLE_MIN_WIDTH_PX = 1150;

async function resizeToDestroyOnboarding(browser) {
  let destroyPromise = ContentTask.spawn(browser, {}, function() {
    return new Promise(resolve => {
      let button = content.document.querySelector("#onboarding-overlay-button");
      button.addEventListener("Agent:Destroy", resolve, { once: true });
    });
  });
  window.innerWidth = 600;
  await destroyPromise;
  return assertOnboardingDestroyed(browser);
}

function promiseOverlayIconButtonChange(browser) {
  function onChange() {
    return new Promise(resolve => {
      let button = content.document.querySelector("#onboarding-overlay-button");
      let observer = new content.MutationObserver(() => {
        observer.disconnect();
        resolve();
      });
      observer.observe(button, { attributes: true });
    });
  }
  return ContentTask.spawn(browser, {}, onChange);
}

function assertSpeechBubbleState(shouldShow, browser) {
  return ContentTask.spawn(browser, { shouldShow }, function(args) {
    let button = content.document.querySelector("#onboarding-overlay-button");
    let shown = button.classList.contains("onboarding-speech-bubble");
    if (args.shouldShow) {
      is(shown, true, "Should show the speech bubble on the overlay icon button");
    } else {
      is(shown, false, "Shouldn't show the speech bubble on the overlay icon button");
    }
  });
}

add_task(async function test_show_blue_dot_by_default_when_window_width_under_1150px() {
  resetOnboardingDefaultState();

  // Test the initial state
  let tab = await openTab(ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await assertSpeechBubbleState(true, tab.linkedBrowser);

  // Test show the blue dot not the speech bubble by default when window width under 1150px
  const originalWidth = window.innerWidth;
  let changePromise = promiseOverlayIconButtonChange(tab.linkedBrowser);
  window.innerWidth = SPEECH_BUBBLE_MIN_WIDTH_PX - 1;
  await changePromise;
  await assertSpeechBubbleState(false, tab.linkedBrowser);

  // Test show the speech bubble again when window width above 1150px
  changePromise = promiseOverlayIconButtonChange(tab.linkedBrowser);
  window.innerWidth = SPEECH_BUBBLE_MIN_WIDTH_PX;
  await changePromise;
  await assertSpeechBubbleState(true, tab.linkedBrowser);

  window.innerWidth = originalWidth;
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_speech_bubble_before_1st_session_then_blue_dot_after_1st_session_by_reload() {
  resetOnboardingDefaultState();

  // Test show the speech bubble before the 1st session
  let tab = await openTab(ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await assertSpeechBubbleState(true, tab.linkedBrowser);

  // Test show the blue dot not the speech bubble after the 1st session
  let muteTime = Preferences.get("browser.onboarding.notification.mute-duration-on-first-session-ms");
  Preferences.set("browser.onboarding.notification.last-time-of-changing-tour-sec", Math.floor((Date.now() - muteTime) / 1000));
  await reloadTab(tab);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  await assertSpeechBubbleState(false, tab.linkedBrowser);
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_speech_bubble_before_1st_session_then_blue_dot_after_1st_session_by_resize() {
  resetOnboardingDefaultState();

  // Test show the speech bubble before the 1st session
  let tab = await openTab(ABOUT_NEWTAB_URL);
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await assertSpeechBubbleState(true, tab.linkedBrowser);

  // Make the onboarding destroyed in a small window
  const originalWidth = window.innerWidth;
  await resizeToDestroyOnboarding(tab.linkedBrowser);

  // Test still show the speech bubble before the 1st session after resizing
  window.innerWidth = SPEECH_BUBBLE_MIN_WIDTH_PX;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await assertSpeechBubbleState(true, tab.linkedBrowser);

  // Make the onboarding destroyed in a small window again
  await resizeToDestroyOnboarding(tab.linkedBrowser);

  // Make the 1st session over
  let muteTime = Preferences.get("browser.onboarding.notification.mute-duration-on-first-session-ms");
  Preferences.set("browser.onboarding.notification.last-time-of-changing-tour-sec", Math.floor((Date.now() - muteTime) / 1000));

  // Test show the blue dot not the speech bubble after the 1st session after resizing
  window.innerWidth = SPEECH_BUBBLE_MIN_WIDTH_PX;
  await promiseOnboardingOverlayLoaded(tab.linkedBrowser);
  await promiseTourNotificationOpened(tab.linkedBrowser);
  await assertSpeechBubbleState(false, tab.linkedBrowser);

  window.innerWidth = originalWidth;
  await BrowserTestUtils.removeTab(tab);
});
