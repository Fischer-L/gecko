/* -*- indent-tabs-mode: nil; js-indent-level: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
const { interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

"use strict";

let gSiteDataRemoveSelected = {

  _tree: null,

  init() {
    this._args = window.arguments[0];
    this._tree = document.getElementById("sitesTree");

    // Organize items for the tree from the argument
    let visibleItems = [];
    let itemsTable = new Map();
    for (let [ baseDomain, hosts ] of this._args.sitesTable) {
      visibleItems.push({
        lv: 0,
        opened: false,
        host: baseDomain
      });
      let items = hosts.map(host => {
        return { host, lv: 1 };
      });
      itemsTable.set(baseDomain, items);
    }
    this._view.itemsTable = itemsTable;
    this._view.visibleItems = visibleItems;
    this._tree.view = this._view;
  },

  ondialogaccept() {
    this._args.allowed = true;
  },

  _view: {
    _selection: null,

    itemsTable: null,

    visibleItems: null,

    get rowCount() {
      return this.visibleItems.length;
    },

    getCellText(index, column) {
      let item = this.visibleItems[index];
      return item ? item.host : "";
    },

    isContainer(index) {
      let item = this.visibleItems[index];
      if (item && item.lv === 0) {
        return true;
      }
      return false;
    },

    isContainerEmpty() {
      return false;
    },

    isContainerOpen(index) {
      let item = this.visibleItems[index];
      if (item && item.lv === 0) {
        return item.opened;
      }
      return false;
    },

    getLevel(index) {
      let item = this.visibleItems[index];
      return item ? item.lv : 0;
    },

    hasNextSibling(index, afterIndex) {
      let item = this.visibleItems[index];
      if (item) {
        let thisLV = this.getLevel(index);
        for (let i = afterIndex + 1; i < this.rowCount; ++i) {
          let nextLV = this.getLevel(i);
          if (nextLV == thisLV) {
            return true;
          }
          if (nextLV < thisLV) {
            break;
          }
        }
      }
      return false;
    },

    getParentIndex(index) {
      if (!this.isContainer(index)) {
        for (let i = index - 1; i >= 0; --i) {
          if (this.isContainer(i)) {
            return i;
          }
        }
      }
      return -1;
    },

    toggleOpenState(index) {
      let item = this.visibleItems[index];
      if (!this.isContainer(index)) {
        return;
      }

      if (item.opened) {
        item.opened = false;

        let i = index;
        let deleteCount = 0;
        for (let i = index + 1; i < this.visibleItems.length; ++i) {
          if (!this.isContainer(i)) {
            ++deleteCount;
          } else {
            break;
          }
        }

        if (deleteCount) {
          this.visibleItems.splice(index + 1, deleteCount);
          this.treeBox.rowCountChanged(index + 1, -deleteCount);
        }
      } else {
        item.opened = true;

        let childItems = this.itemsTable.get(item.host);
        for (let i = 0; i < childItems.length; i++) {
          this.visibleItems.splice(index + i + 1, 0, childItems[i]);
        }
        this.treeBox.rowCountChanged(index + 1, childItems.length);
      }
      this.treeBox.invalidateRow(index);
    },

    get selection() { return this._selection; },
    set selection(v) { this._selection = v; return v;},
    setTree(treeBox) { this.treeBox = treeBox; },
    hasPreviousSibling(index) {},
    isSeparator(index) { return false; },
    isSorted(index) { return false; },
    canDrop() { return false; },
    drop() {},
    getRowProperties() {},
    getCellProperties() {},
    getColumnProperties() {},
    hasPreviousSibling() {},
    getImageSrc() {},
    getProgressMode() {},
    getCellValue() {},
    cycleHeader() {},
    selectionChanged() {},
    cycleCell() {},
    isEditable() {},
    isSelectable() {},
    setCellValue() {},
    setCellText() {},
    performAction() {},
    performActionOnRow() {},
    performActionOnCell() {}
  }
};
