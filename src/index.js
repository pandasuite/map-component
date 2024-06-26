import PandaBridge from 'pandasuite-bridge';

import isEqual from 'lodash/isEqual';

let mapHandler = null;
let initialFitBounds = null;

let properties = null;
let markers = null;

async function setupLeafletMapEditor() {
  const { default: LeafletEditor } = await import('./LeafletEditor');
  mapHandler = new LeafletEditor(properties, markers, initialFitBounds);
}

async function setupLeafletMap() {
  const { default: Leaflet } = await import('./Leaflet');
  mapHandler = new Leaflet(properties, markers, initialFitBounds);
}

function myInit() {
  /* We use leaflet for easy editing of interactive elements */
  if (PandaBridge.isStudio) {
    const { scale = 1 } = PandaBridge.isStudio;

    document.body.style.setProperty('--scale', scale);
    document.body.style.setProperty('--scale-inverse', 1 / scale);

    setupLeafletMapEditor();
  } else if (
    properties.type === 'OpenStreetMap' ||
    properties.type === 'Mapbox' ||
    properties.type === 'GoogleMaps'
  ) {
    setupLeafletMap();
  }
}

PandaBridge.init(() => {
  PandaBridge.onLoad((pandaData) => {
    properties = pandaData.properties;
    markers = pandaData.markers;

    if (document.readyState === 'complete') {
      myInit();
    } else {
      document.addEventListener('DOMContentLoaded', myInit, false);
    }
  });

  PandaBridge.onUpdate((pandaData) => {
    if (!isEqual(properties, pandaData.properties)) {
      properties = pandaData.properties;
      if (mapHandler != null) {
        mapHandler.updateProperties(properties);
      }
    }
    if (!isEqual(markers, pandaData.markers)) {
      markers = pandaData.markers;
      if (mapHandler != null) {
        mapHandler.updateMarkers(markers);
      }
    }
  });

  /* Markers */

  PandaBridge.getSnapshotData(() => null);

  PandaBridge.setSnapshotData(({ data }) => {
    if (mapHandler != null && data) {
      mapHandler.selectMarkers(data);
    }
  });

  /* Actions */

  PandaBridge.listen('changeMap', (args) => {
    const [params] = args || {};

    if (mapHandler != null && params) {
      mapHandler.setMapView(params);
    }
  });

  PandaBridge.listen('fitBounds', (args) => {
    const [params] = args || {};
    const { paddingVertical = 0, paddingHorizontal = 0 } = params || {};

    if (mapHandler != null) {
      mapHandler.fitMapView({ padding: [paddingVertical, paddingHorizontal] });
    } else {
      initialFitBounds = { padding: [paddingVertical, paddingHorizontal] };
    }
  });
});
