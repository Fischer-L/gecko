/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Ci = Components.interfaces;
const Cu = Components.utils;
const Cc = Components.classes;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Prompt",
                                  "resource://gre/modules/Prompt.jsm");

// -----------------------------------------------------------------------
// NSS Dialog Service
// -----------------------------------------------------------------------

function dump(a) {
  Components.classes["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService).logStringMessage(a);
}

function NSSDialogs() { }

NSSDialogs.prototype = {
  classID: Components.ID("{cbc08081-49b6-4561-9c18-a7707a50bda1}"),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsICertificateDialogs, Ci.nsIClientAuthDialogs]),

  getString: function(aName) {
    if (!this.bundle) {
        this.bundle = Services.strings.createBundle("chrome://browser/locale/pippki.properties");
    }
    return this.bundle.GetStringFromName(aName);
  },

  formatString: function(aName, argList) {
    if (!this.bundle) {
      this.bundle = Services.strings.createBundle("chrome://browser/locale/pippki.properties");
    }
    return this.bundle.formatStringFromName(aName, argList, argList.length);
  },

  getPrompt: function(aTitle, aText, aButtons) {
    return new Prompt({
      title: aTitle,
      text: aText,
      buttons: aButtons,
    });
  },

  showPrompt: function(aPrompt) {
    let response = null;
    aPrompt.show(function(data) {
      response = data;
    });

    // Spin this thread while we wait for a result
    let thread = Services.tm.currentThread;
    while (response === null)
      thread.processNextEvent(true);

    return response;
  },

  confirmDownloadCACert: function(aCtx, aCert, aTrust) {
    while (true) {
      let prompt = this.getPrompt(this.getString("downloadCert.title"),
                                  this.getString("downloadCert.message1"),
                                  [ this.getString("nssdialogs.ok.label"),
                                    this.getString("downloadCert.viewCert.label"),
                                    this.getString("nssdialogs.cancel.label")
                                  ]);

      prompt.addCheckbox({ id: "trustSSL", label: this.getString("downloadCert.trustSSL"), checked: false })
            .addCheckbox({ id: "trustEmail", label: this.getString("downloadCert.trustEmail"), checked: false })
            .addCheckbox({ id: "trustSign", label: this.getString("downloadCert.trustObjSign"), checked: false });
      let response = this.showPrompt(prompt);

      // they hit the "view cert" button, so show the cert and try again
      if (response.button == 1) {
        this.viewCert(aCtx, aCert);
        continue;
      } else if (response.button != 0) {
        return false;
      }

      aTrust.value = Ci.nsIX509CertDB.UNTRUSTED;
      if (response.trustSSL) aTrust.value |= Ci.nsIX509CertDB.TRUSTED_SSL;
      if (response.trustEmail) aTrust.value |= Ci.nsIX509CertDB.TRUSTED_EMAIL;
      if (response.trustSign) aTrust.value |= Ci.nsIX509CertDB.TRUSTED_OBJSIGN;
      return true;
    }
  },

  setPKCS12FilePassword: function(aCtx, aPassword) {
    // this dialog is never shown in Fennec; in Desktop it is shown while backing up a personal
    // certificate to a file via Preferences->Advanced->Encryption->View Certificates->Your Certificates
    throw "Unimplemented";
  },

  getPKCS12FilePassword: function(aCtx, aPassword) {
    let prompt = this.getPrompt(this.getString("pkcs12.getpassword.title"),
                                this.getString("pkcs12.getpassword.message"),
                                [ this.getString("nssdialogs.ok.label"),
                                  this.getString("nssdialogs.cancel.label")
                                ]).addPassword({id: "pw"});
    let response = this.showPrompt(prompt);
    if (response.button != 0) {
      return false;
    }

    aPassword.value = response.pw;
    return true;
  },

  certInfoSection: function(aHeading, aDataPairs, aTrailingNewline = true) {
    var str = "<big>" + this.getString(aHeading) + "</big><br/>";
    for (var i = 0; i < aDataPairs.length; i += 2) {
      str += this.getString(aDataPairs[i]) + ": " + aDataPairs[i+1] + "<br/>";
    }
    return str + (aTrailingNewline ? "<br/>" : "");
  },

  viewCert: function(aCtx, aCert) {
    let p = this.getPrompt(this.getString("certmgr.title"),
                    "",
                    [ this.getString("nssdialogs.ok.label") ])
    p.addLabel({ label: this.certInfoSection("certmgr.subjectinfo.label",
                          ["certmgr.certdetail.cn", aCert.commonName,
                           "certmgr.certdetail.o", aCert.organization,
                           "certmgr.certdetail.ou", aCert.organizationalUnit,
                           "certmgr.certdetail.serialnumber", aCert.serialNumber])})
     .addLabel({ label: this.certInfoSection("certmgr.issuerinfo.label",
                          ["certmgr.certdetail.cn", aCert.issuerCommonName,
                           "certmgr.certdetail.o", aCert.issuerOrganization,
                           "certmgr.certdetail.ou", aCert.issuerOrganizationUnit])})
     .addLabel({ label: this.certInfoSection("certmgr.periodofvalidity.label",
                          ["certmgr.begins", aCert.validity.notBeforeLocalDay,
                           "certmgr.expires", aCert.validity.notAfterLocalDay])})
     .addLabel({ label: this.certInfoSection("certmgr.fingerprints.label",
                          ["certmgr.certdetail.sha256fingerprint", aCert.sha256Fingerprint,
                           "certmgr.certdetail.sha1fingerprint", aCert.sha1Fingerprint], false) });
    this.showPrompt(p);
  },

  /**
   * Returns a list of details of the given cert relevant for TLS client
   * authentication.
   *
   * @param {nsIX509Cert} cert Cert to get the details of.
   * @returns {String} <br/> delimited list of details.
   */
  getCertDetails: function(cert) {
    let detailLines = [
      this.formatString("clientAuthAsk.issuedTo", [cert.subjectName]),
      this.formatString("clientAuthAsk.serial", [cert.serialNumber]),
      this.formatString("clientAuthAsk.validityPeriod",
                        [cert.validity.notBeforeLocalTime,
                         cert.validity.notAfterLocalTime]),
    ];
    let keyUsages = cert.keyUsages;
    if (keyUsages) {
      detailLines.push(this.formatString("clientAuthAsk.keyUsages",
                                         [keyUsages]));
    }
    let emailAddresses = cert.getEmailAddresses({});
    if (emailAddresses.length > 0) {
      let joinedAddresses = emailAddresses.join(", ");
      detailLines.push(this.formatString("clientAuthAsk.emailAddresses",
                                         [joinedAddresses]));
    }
    detailLines.push(this.formatString("clientAuthAsk.issuedBy",
                                       [cert.issuerName]));
    detailLines.push(this.formatString("clientAuthAsk.storedOn",
                                       [cert.tokenName]));

    return detailLines.join("<br/>");
  },

  viewCertDetails: function(details) {
    let p = this.getPrompt(this.getString("clientAuthAsk.message3"),
                    '',
                    [ this.getString("nssdialogs.ok.label") ]);
    p.addLabel({ label: details });
    this.showPrompt(p);
  },

  chooseCertificate: function(ctx, cnAndPort, organization, issuerOrg, certList,
                              selectedIndex) {
    let rememberSetting =
      Services.prefs.getBoolPref("security.remember_cert_checkbox_default_setting");

    let serverRequestedDetails = [
      cnAndPort,
      this.formatString("clientAuthAsk.organization", [organization]),
      this.formatString("clientAuthAsk.issuer", [issuerOrg]),
    ].join("<br/>");

    let certNickList = [];
    let certDetailsList = [];
    for (let i = 0; i < certList.length; i++) {
      let cert = certList.queryElementAt(i, Ci.nsIX509Cert);
      certNickList.push(this.formatString("clientAuthAsk.nickAndSerial",
                                          [cert.nickname, cert.serialNumber]));
      certDetailsList.push(this.getCertDetails(cert));
    }

    selectedIndex.value = 0;
    while (true) {
      let buttons = [
        this.getString("nssdialogs.ok.label"),
        this.getString("clientAuthAsk.viewCert.label"),
        this.getString("nssdialogs.cancel.label"),
      ];
      let prompt = this.getPrompt(this.getString("clientAuthAsk.title"),
                                  this.getString("clientAuthAsk.message1"),
                                  buttons)
      .addLabel({ id: "requestedDetails", label: serverRequestedDetails } )
      .addMenulist({
        id: "nicknames",
        label: this.getString("clientAuthAsk.message2"),
        values: certNickList,
        selected: selectedIndex.value,
      }).addCheckbox({
        id: "rememberBox",
        label: this.getString("clientAuthAsk.remember.label"),
        checked: rememberSetting
      });
      let response = this.showPrompt(prompt);
      selectedIndex.value = response.nicknames;
      if (response.button == 1 /* buttons[1] */) {
        this.viewCertDetails(certDetailsList[selectedIndex.value]);
        continue;
      } else if (response.button == 0 /* buttons[0] */) {
        if (response.rememberBox == true) {
          let caud = ctx.QueryInterface(Ci.nsIClientAuthUserDecision);
          if (caud) {
            caud.rememberClientAuthCertificate = true;
          }
        }
        return true;
      }
      return false;
    }
  }
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([NSSDialogs]);
