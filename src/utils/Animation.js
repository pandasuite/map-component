import * as L from 'leaflet';

/* eslint-disable import/prefer-default-export */
export const addBounceAnimation = (layer) => {
  const element = layer.getElement();

  if (!element) {
    return;
  }

  function toggleAnimation() {
    L.DomUtil.addClass(element, 'blink-animation');

    element.addEventListener(
      'animationend',
      () => {
        L.DomUtil.removeClass(element, 'blink-animation');
      },
      { once: true },
    );
  }

  toggleAnimation();
};
