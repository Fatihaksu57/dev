// ============================================================
//  SiteSketch – iOS / Platform Utilities
// ============================================================

const iOS = {
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
    nextFrame:       () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    forceLayout:     (el) => { el.offsetHeight; return el; },
    getViewportHeight: () => window.visualViewport ? window.visualViewport.height : window.innerHeight
};
