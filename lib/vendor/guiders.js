/**
 * guiders.js
 *
 * version 2.0.0
 *
 * Released under the Apache License 2.0.
 * www.apache.org/licenses/LICENSE-2.0.html
 *
 * Questions about Guiders?
 * Email me (Jeff Pickhardt) at pickhardt@gmail.com
 *
 * Questions about Optimizely? Email one of the following:
 * sales@optimizely.com or support@optimizely.com
 *
 * Enjoy!
 */

export const guiders = {};

(() => {
  guiders.version = "2.0.0";

  guiders._defaultSettings = {
    attachTo: null,
    autoFocus: false,
    buttons: [{name: "Close"}],
    buttonCustomHTML: "",
    classString: null,
    closeOnEscape: false,
    description: "Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
    highlight: null,
    isHashable: true,
    maxWidth: null,
    offset: {
      top: null,
      left: null
    },
    onClose: null,
    onHide: null,
    onShow: null,
    overlay: false,
    position: 0,
    shouldSkip: function() {},
    title: "Sample title goes here",
    width: 400,
    xButton: false
  };

  guiders._htmlSkeleton = [
    "<div class='guider'>",
    "  <div class='guiders_content'>",
    "    <h1 class='guiders_title'></h1>",
    "    <div class='guiders_close'></div>",
    "    <p class='guiders_description'></p>",
    "    <div class='guiders_buttons_container'>",
    "    </div>",
    "  </div>",
    "  <div class='guiders_arrow'>",
    "  </div>",
    "</div>"
  ].join("");

  guiders._arrowSize = 42;
  guiders._backButtonTitle = "Back";
  guiders._buttonAttributes = {"href": "javascript:void(0);"};
  guiders._buttonClassName = "guiders_button";
  guiders._buttonClickEvent = "click";
  guiders._buttonElement = "a";
  guiders._closeButtonTitle = "Close";
  guiders._currentGuiderID = null;
  guiders._fixedOrAbsolute = "fixed";
  guiders._guiders = {};
  guiders._lastCreatedGuiderID = null;
  guiders._nextButtonTitle = "Next";
  guiders._offsetNameMapping = {
    "topLeft": 11,
    "top": 12,
    "topRight": 1,
    "rightTop": 2,
    "right": 3,
    "rightBottom": 4,
    "bottomRight": 5,
    "bottom": 6,
    "bottomLeft": 7,
    "leftBottom": 8,
    "left": 9,
    "leftTop": 10
  };
  guiders._windowHeight = 0;

  var ieBrowserMatch = navigator.userAgent.match(/MSIE\s([\d.]+)/);
  guiders._isIE = ieBrowserMatch && ieBrowserMatch.length > 1;
  guiders._ieVersion = ieBrowserMatch && ieBrowserMatch.length > 1 ? Number(ieBrowserMatch[1]) : -1;

  guiders._addButtons = function(myGuider) {
    var guiderButtonsContainer = myGuider.elem.querySelector(".guiders_buttons_container");

    if (myGuider.buttons === null || myGuider.buttons.length === 0) {
      guiderButtonsContainer.remove();
      return;
    }

    for (var i = myGuider.buttons.length - 1; i >= 0; i--) {
      var thisButton = myGuider.buttons[i];
      var thisButtonElem = document.createElement(guiders._buttonElement);
      thisButtonElem.className = guiders._buttonClassName;
      thisButtonElem.innerHTML = thisButton.name;
      for (var attr in guiders._buttonAttributes) {
        thisButtonElem.setAttribute(attr, guiders._buttonAttributes[attr]);
      }
      if (thisButton.html) {
        for (var htmlAttr in thisButton.html) {
          thisButtonElem.setAttribute(htmlAttr, thisButton.html[htmlAttr]);
        }
      }

      if (typeof thisButton.classString !== "undefined" && thisButton.classString !== null) {
        thisButtonElem.classList.add(...thisButton.classString.split(/\s+/));
      }

      guiderButtonsContainer.appendChild(thisButtonElem);

      var thisButtonName = thisButton.name.toLowerCase();
      if (thisButton.onclick) {
        thisButtonElem.addEventListener("click", thisButton.onclick);
      } else {
        switch (thisButtonName) {
          case guiders._closeButtonTitle.toLowerCase():
            thisButtonElem.addEventListener("click", function () {
              guiders.hideAll();
              if (myGuider.onClose) {
                myGuider.onClose(myGuider, false);
              }
              document.body.dispatchEvent(new CustomEvent("guidersClose"));
            });
            break;
          case guiders._nextButtonTitle.toLowerCase():
            thisButtonElem.addEventListener("click", function () {
              if (!myGuider.elem._locked) guiders.next();
            });
            break;
          case guiders._backButtonTitle.toLowerCase():
            thisButtonElem.addEventListener("click", function () {
              if (!myGuider.elem._locked) guiders.prev();
            });
            break;
        }
      }
    }

    if (myGuider.buttonCustomHTML !== "") {
      var temp = document.createElement("div");
      temp.innerHTML = myGuider.buttonCustomHTML;
      while (temp.firstChild) {
        myGuider.elem.querySelector(".guiders_buttons_container").appendChild(temp.firstChild);
      }
    }

    if (myGuider.buttons.length === 0) {
      guiderButtonsContainer.remove();
    }
  };

  guiders._addXButton = function(myGuider) {
    var xButtonContainer = myGuider.elem.querySelector(".guiders_close");
    var xButton = document.createElement("div");
    xButton.className = "guiders_x_button";
    xButton.setAttribute("role", "button");
    xButtonContainer.appendChild(xButton);
    xButton.addEventListener("click", function() {
      guiders.hideAll();
      if (myGuider.onClose) {
        myGuider.onClose(myGuider, true);
       }
       document.body.dispatchEvent(new CustomEvent("guidersClose"));
    });
  };

  guiders._attach = function(myGuider) {
    if (typeof myGuider !== 'object') {
      return;
    }

    var attachTo = myGuider.attachTo ? document.querySelector(myGuider.attachTo) : null;

    var myHeight = myGuider.elem.offsetHeight;
    var myWidth = myGuider.elem.offsetWidth;

    if (myGuider.position === 0 || !attachTo) {
      var fixedOrAbsolute = "fixed";
      if (guiders._isIE && guiders._ieVersion < 9) {
        fixedOrAbsolute = "absolute";
      }
      myGuider.elem.style.position = fixedOrAbsolute;
      myGuider.elem.style.top = (window.innerHeight - myHeight) / 3 + "px";
      myGuider.elem.style.left = (window.innerWidth - myWidth) / 2 + "px";
      return;
    }

    var base = attachTo.getBoundingClientRect();
    var top = base.top + window.scrollY;
    var left = base.left + window.scrollX;

    var topMarginOfBody = parseInt(window.getComputedStyle(document.body).marginTop, 10) || 0;
    top -= topMarginOfBody;

    if (guiders._offsetNameMapping[myGuider.position]) {
      myGuider.position = guiders._offsetNameMapping[myGuider.position];
    }

    var attachToHeight = attachTo.offsetHeight;
    var attachToWidth = attachTo.offsetWidth;
    var bufferOffset = 0.9 * guiders._arrowSize;

    var offsetMap = {
      1: [-bufferOffset - myHeight, attachToWidth - myWidth],
      2: [0, bufferOffset + attachToWidth],
      3: [attachToHeight/2 - myHeight/2, bufferOffset + attachToWidth],
      4: [attachToHeight - myHeight, bufferOffset + attachToWidth],
      5: [bufferOffset + attachToHeight, attachToWidth - myWidth],
      6: [bufferOffset + attachToHeight, attachToWidth/2 - myWidth/2],
      7: [bufferOffset + attachToHeight, 0],
      8: [attachToHeight - myHeight, -myWidth - bufferOffset],
      9: [attachToHeight/2 - myHeight/2, -myWidth - bufferOffset],
      10: [0, -myWidth - bufferOffset],
      11: [-bufferOffset - myHeight, 0],
      12: [-bufferOffset - myHeight, attachToWidth/2 - myWidth/2]
    };

    var offset = offsetMap[myGuider.position];
    top += offset[0];
    left += offset[1];

    var positionType = "absolute";
    if (window.getComputedStyle(attachTo).position === "fixed" && guiders._fixedOrAbsolute === "fixed") {
      positionType = "fixed";
      top -= window.scrollY;
      left -= window.scrollX;
    }

    if (myGuider.offset.top !== null) {
      top += myGuider.offset.top;
    }
    if (myGuider.offset.left !== null) {
      left += myGuider.offset.left;
    }

    guiders._styleArrow(myGuider);

    myGuider.elem.style.position = positionType;
    myGuider.elem.style.top = top + "px";
    myGuider.elem.style.left = left + "px";

    return myGuider;
  };

  guiders._dehighlightElement = function(selector) {
    var el = document.querySelector(selector);
    if (el) el.classList.remove('guiders_highlight');
  };

  guiders._hideOverlay = function() {
    var overlay = document.getElementById("guiders_overlay");
    if (overlay) {
      overlay.style.transition = "opacity 0.2s";
      overlay.style.opacity = "0";
      setTimeout(function() { overlay.style.display = "none"; overlay.style.transition = ""; }, 200);
    }
  };

  guiders._highlightElement = function(selector) {
    var el = document.querySelector(selector);
    if (el) el.classList.add('guiders_highlight');
  };

  guiders._initializeOverlay = function() {
    if (!document.getElementById("guiders_overlay")) {
      var overlay = document.createElement("div");
      overlay.id = "guiders_overlay";
      overlay.style.display = "none";
      document.body.appendChild(overlay);
    }
  };

  guiders._showOverlay = function(myGuider) {
    var overlay = document.getElementById("guiders_overlay");
    if (overlay) {
      overlay.style.display = "";
      overlay.style.opacity = "0";
      requestAnimationFrame(function() { overlay.style.transition = "opacity 0.2s"; overlay.style.opacity = "1"; });
    }
    if (guiders._isIE && overlay) {
      overlay.style.position = "absolute";
    }
  };

  guiders._styleArrow = function(myGuider) {
    var position = myGuider.position || 0;
    if (!position) {
      return;
    }
    var myGuiderArrow = myGuider.elem.querySelector(".guiders_arrow");
    var newClass = {
      1: "guiders_arrow_down",
      2: "guiders_arrow_left",
      3: "guiders_arrow_left",
      4: "guiders_arrow_left",
      5: "guiders_arrow_up",
      6: "guiders_arrow_up",
      7: "guiders_arrow_up",
      8: "guiders_arrow_right",
      9: "guiders_arrow_right",
      10: "guiders_arrow_right",
      11: "guiders_arrow_down",
      12: "guiders_arrow_down"
    };
    myGuiderArrow.classList.add(newClass[position]);

    var myHeight = myGuider.elem.offsetHeight;
    var myWidth = myGuider.elem.offsetWidth;
    var arrowOffset = guiders._arrowSize / 2;
    var positionMap = {
      1: ["right", arrowOffset],
      2: ["top", arrowOffset],
      3: ["top", myHeight/2 - arrowOffset],
      4: ["bottom", arrowOffset],
      5: ["right", arrowOffset],
      6: ["left", myWidth/2 - arrowOffset],
      7: ["left", arrowOffset],
      8: ["bottom", arrowOffset],
      9: ["top", myHeight/2 - arrowOffset],
      10: ["top", arrowOffset],
      11: ["left", arrowOffset],
      12: ["left", myWidth/2 - arrowOffset]
    };
    var pos = positionMap[myGuider.position];
    myGuiderArrow.style[pos[0]] = pos[1] + "px";
  };

  guiders._showIfHashed = function(myGuider) {
    var GUIDER_HASH_TAG = "guider=";
    var hashIndex = window.location.hash.indexOf(GUIDER_HASH_TAG);
    if (hashIndex !== -1) {
      var hashGuiderId = window.location.hash.substr(hashIndex + GUIDER_HASH_TAG.length);
      if (myGuider.id.toLowerCase() === hashGuiderId.toLowerCase()) {
        guiders.show(myGuider.id);
      }
    }
  };

  guiders._updatePositionOnResize = function() {
    var _resizing = undefined;
    window.addEventListener("resize", function() {
      if (typeof(_resizing) !== "undefined") {
        clearTimeout(_resizing);
      }
      _resizing = setTimeout(function() {
        _resizing = undefined;
        if (typeof (guiders) !== "undefined") {
          guiders.reposition();
        }
      }, 20);
    });
  };
  guiders._updatePositionOnResize();

  guiders._unwireEscape = function (myGuider) {
    document.removeEventListener("keydown", guiders._escapeHandler);
  };

  guiders._escapeHandler = null;

  guiders._wireEscape = function (myGuider) {
    if (guiders._escapeHandler) {
      document.removeEventListener("keydown", guiders._escapeHandler);
    }
    guiders._escapeHandler = function(event) {
      if (event.keyCode == 27 || event.which == 27) {
        guiders.hideAll();
        if (myGuider.onClose) {
          myGuider.onClose(myGuider, true);
        }
        document.body.dispatchEvent(new CustomEvent("guidersClose"));
        return false;
      }
    };
    document.addEventListener("keydown", guiders._escapeHandler);
  };

  guiders.createGuider = function(passedSettings) {
    if (passedSettings === null || passedSettings === undefined) {
      passedSettings = {};
    }

    var myGuider = Object.assign({}, guiders._defaultSettings, passedSettings);
    myGuider.id = myGuider.id || "guider_random_" + String(Math.floor(Math.random() * 1000));

    var guiderElement = document.getElementById(myGuider.id);
    if (!guiderElement) {
      var temp = document.createElement("div");
      temp.innerHTML = guiders._htmlSkeleton;
      guiderElement = temp.firstChild;
    }

    myGuider.elem = guiderElement;
    if (typeof myGuider.classString !== "undefined" && myGuider.classString !== null) {
      myGuider.elem.classList.add(...myGuider.classString.split(/\s+/));
    }

    if (Number(myGuider.width) === myGuider.width) {
      myGuider.width = String(myGuider.width) + "px";
    }
    if (Number(myGuider.maxWidth) === myGuider.maxWidth) {
      myGuider.maxWidth = String(myGuider.maxWidth) + "px";
    }
    myGuider.elem.style.width = myGuider.width;
    myGuider.elem.style.maxWidth = myGuider.maxWidth || '';

    var guiderTitleContainer = guiderElement.querySelector(".guiders_title");
    guiderTitleContainer.innerHTML = myGuider.title;

    guiderElement.querySelector(".guiders_description").innerHTML = myGuider.description;

    guiders._addButtons(myGuider);

    if (myGuider.xButton) {
        guiders._addXButton(myGuider);
    }

    guiderElement.style.display = "none";
    document.body.appendChild(guiderElement);
    guiderElement.id = myGuider.id;

    if (typeof myGuider.attachTo !== "undefined" && myGuider !== null) {
      guiders._attach(myGuider);
    }

    guiders._initializeOverlay();

    guiders._guiders[myGuider.id] = myGuider;
    if (guiders._lastCreatedGuiderID != null) {
      myGuider.prev = guiders._lastCreatedGuiderID;
    }
    guiders._lastCreatedGuiderID = myGuider.id;

    if (myGuider.isHashable) {
      guiders._showIfHashed(myGuider);
    }

    return guiders;
  };

  guiders.get = function(id) {
    if (typeof guiders._guiders[id] === "undefined") {
      return null;
    }
    return guiders._guiders[id] || null;
  };

  guiders.getCurrentGuider = function() {
    return guiders._guiders[guiders._currentGuiderID] || null;
  };

  guiders.hideAll = function(omitHidingOverlay, next) {
    next = next || false;

    for (var guiderEl of document.querySelectorAll(".guider")) {
      if (guiderEl.style.display !== "none") {
        var myGuider = guiders.get(guiderEl.id);
        if (myGuider && myGuider.onHide) {
          myGuider.onHide(myGuider, next);
        }
      }
    }
    for (var g of document.querySelectorAll(".guider")) {
      g.style.transition = "opacity 0.2s";
      g.style.opacity = "0";
      setTimeout(((el) => () => { el.style.display = "none"; el.style.transition = ""; el.style.opacity = ""; })(g), 200);
    }
    var currentGuider = guiders._guiders[guiders._currentGuiderID];
    if (currentGuider && currentGuider.highlight) {
       guiders._dehighlightElement(currentGuider.highlight);
    }
    if (typeof omitHidingOverlay !== "undefined" && omitHidingOverlay === true) {
      // do nothing for now
    } else {
      guiders._hideOverlay();
    }
    return guiders;
  };

  guiders.next = function() {
    var currentGuider = guiders._guiders[guiders._currentGuiderID];
    if (typeof currentGuider === "undefined") {
      return null;
    }
    currentGuider.elem._locked = true;

    var nextGuiderId = currentGuider.next || null;
    if (nextGuiderId !== null && nextGuiderId !== "") {
      var nextGuider = guiders.get(nextGuiderId);
      var omitHidingOverlay = nextGuider.overlay ? true : false;
      guiders.hideAll(omitHidingOverlay, true);
      if (currentGuider && currentGuider.highlight) {
        guiders._dehighlightElement(currentGuider.highlight);
      }

      if (nextGuider.shouldSkip && nextGuider.shouldSkip()) {
        guiders._currentGuiderID = nextGuider.id;
        guiders.next();
        return guiders.getCurrentGuider();
      }
      else {
        guiders.show(nextGuiderId);
        return guiders.getCurrentGuider();
      }
    }
  };

  guiders.prev = function () {
    var currentGuider = guiders._guiders[guiders._currentGuiderID];
    if (typeof currentGuider === "undefined") {
      return null;
    }
    if (currentGuider.prev === null) {
      return null;
    }

    var prevGuider = guiders._guiders[currentGuider.prev];
    prevGuider.elem._locked = true;

    var prevGuiderId = prevGuider.id || null;
    if (prevGuiderId !== null && prevGuiderId !== "") {
      var myGuider = guiders.get(prevGuiderId);
      var omitHidingOverlay = myGuider.overlay ? true : false;
      guiders.hideAll(omitHidingOverlay, true);
      if (prevGuider && prevGuider.highlight) {
        guiders._dehighlightElement(prevGuider.highlight);
      }
      guiders.show(prevGuiderId);
      return myGuider;
    }
  };

  guiders.reposition = function() {
    var currentGuider = guiders._guiders[guiders._currentGuiderID];
    guiders._attach(currentGuider);
  };

  guiders.scrollToCurrent = function() {
    var currentGuider = guiders._guiders[guiders._currentGuiderID];
    if (typeof currentGuider === "undefined") {
      return;
    }

    var windowHeight = guiders._windowHeight;
    var guiderRect = currentGuider.elem.getBoundingClientRect();
    var guiderOffset = { top: guiderRect.top + window.scrollY };
    var guiderElemHeight = currentGuider.elem.offsetHeight;

    var scrollToHeight = Math.round(Math.max(guiderOffset.top + (guiderElemHeight / 2) - (windowHeight / 2), 0));
    window.scrollTo(0, scrollToHeight);
  };

  guiders.show = function(id) {
    if (!id && guiders._lastCreatedGuiderID) {
      id = guiders._lastCreatedGuiderID;
    }

    var myGuider = guiders.get(id);
    if (myGuider.overlay) {
      guiders._showOverlay(myGuider);
      if (myGuider.highlight && myGuider.attachTo) {
        guiders._highlightElement(myGuider.attachTo);
      }
    }

    if (myGuider.closeOnEscape) {
      guiders._wireEscape(myGuider);
    } else {
      guiders._unwireEscape(myGuider);
    }

    if (myGuider.onShow) {
      myGuider.onShow(myGuider);
    }
    guiders._attach(myGuider);
    myGuider.elem.style.display = "";
    myGuider.elem.style.opacity = "0";
    requestAnimationFrame(function() {
      myGuider.elem.style.transition = "opacity 0.2s";
      myGuider.elem.style.opacity = "1";
      setTimeout(function() { myGuider.elem.style.transition = ""; }, 200);
    });
    myGuider.elem._locked = false;

    guiders._currentGuiderID = id;

    var windowHeight = guiders._windowHeight = window.innerHeight;
    var scrollHeight = window.scrollY;
    var guiderRect = myGuider.elem.getBoundingClientRect();
    var guiderOffset = { top: guiderRect.top + window.scrollY };
    var guiderElemHeight = myGuider.elem.offsetHeight;

    var isGuiderBelow = (scrollHeight + windowHeight < guiderOffset.top + guiderElemHeight);
    var isGuiderAbove = (guiderOffset.top < scrollHeight);

    if (myGuider.autoFocus && (isGuiderBelow || isGuiderAbove)) {
      setTimeout(guiders.scrollToCurrent, 10);
    }

    myGuider.elem.dispatchEvent(new CustomEvent("guiders.show"));

    return guiders;
  };
})();
