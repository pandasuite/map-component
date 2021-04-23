import PandaBridge from 'pandasuite-bridge';

import isEqual from 'lodash/isEqual';

let mapHandler = null;

let properties = null;
let markers = null;

async function setupLeafletMapEditor() {
  const { default: LeafletEditor } = await import('./LeafletEditor');
  mapHandler = new LeafletEditor(properties, markers);
}

async function setupLeafletMap() {
  const { default: Leaflet } = await import('./Leaflet');
  mapHandler = new Leaflet(properties, markers);
}

function myInit() {
  /* We use leaflet for easy editing of interactive elements */
  if (PandaBridge.isStudio) {
    setupLeafletMapEditor();
  } else if (properties.type === 'OpenStreetMap' || properties.type === 'Mapbox') {
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
});
