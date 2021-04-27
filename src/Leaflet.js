import PandaBridge from 'pandasuite-bridge';

import * as L from 'leaflet';
import 'leaflet.locatecontrol';

import 'leaflet/dist/leaflet.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.min.css';
import 'font-awesome/css/font-awesome.min.css';

import each from 'lodash/each';

import { geoJSONToLayer, patchDefaultIcons, setupLayerFromMarker } from './utils/Leaflet';

patchDefaultIcons();

export default class Leaflet {
  constructor(properties, markers) {
    this.properties = properties;
    this.markers = markers;
    this.map = L.map('map').setView([properties.lat, properties.lng], properties.zoom);
    this.layersLookup = {};

    this.setupMapLayer();
    this.locate = this.setupLocate();
    this.setupMarkers();
    this.setupHooks();
  }

  getTileLayerFromProps() {
    switch (this.properties.type) {
      case 'Mapbox':
        return L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
          attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
          id: this.properties.mapboxStyle.replace('mapbox://styles/', ''),
          tileSize: 512,
          zoomOffset: -1,
          accessToken: this.properties.mapboxAccessToken,
        });

      case 'GoogleMaps':
        return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        });

      default:
        return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        });
    }
  }

  setupMapLayer() {
    this.mapLayer = this.getTileLayerFromProps();
    this.mapLayer.addTo(this.map);
  }

  attachEventsToLayer(layer) {
    this.layersLookup[layer.uniqueId] = layer;

    layer.on('click', (e) => {
      PandaBridge.send(PandaBridge.TRIGGER_MARKER, e.target.uniqueId);
    });
  }

  setupLocate() {
    if (this.properties.geolocation) {
      const locate = L.control.locate({
        locateOptions: {
          enableHighAccuracy: true,
          showPopup: false,
          setView: this.properties.setView === 'false' ? false : this.properties.setView,
        },
      });
      this.map.addControl(locate);
      return locate;
    }
    return null;
  }

  setupMarkers() {
    this.markers.forEach((marker) => {
      const layer = geoJSONToLayer(marker.data);
      setupLayerFromMarker(layer, marker);
      layer.addTo(this.map);
      this.attachEventsToLayer(layer);
    });
  }

  setupHooks() {
    this.map.on('moveend', () => {
      const center = this.map.getCenter();
      const schema = {
        lat: center.lat,
        lng: center.lng,
        zoom: this.map.getZoom(),
      };

      PandaBridge.send('mapChanged', [schema]);
      PandaBridge.send(PandaBridge.UPDATED, {
        queryable: {
          map: schema,
        },
      });
    });
  }

  updateProperties(properties) {
    this.properties = properties;
    this.map.removeLayer(this.mapLayer);
    if (this.locate) {
      this.map.removeControl(this.locate);
    }
    this.setupMapLayer();
    this.locate = this.setupLocate();
  }

  updateMarkers(markers) {
    const markerLayers = {};
    const pathLayers = {};

    this.markers = markers;

    this.map.eachLayer((layer) => {
      if (layer instanceof L.Marker && layer.uniqueId) {
        markerLayers[layer.uniqueId] = { layer };
      }
      if (layer instanceof L.Path) {
        pathLayers[layer.uniqueId] = { layer };
      }
    });

    each(this.markers, (marker) => {
      if (markerLayers[marker.id]) {
        const { layer } = markerLayers[marker.id];

        setupLayerFromMarker(layer, marker);
        delete markerLayers[marker.id];
      }
      if (pathLayers[marker.id]) {
        const { layer } = pathLayers[marker.id];

        setupLayerFromMarker(layer, marker);
        delete pathLayers[marker.id];
      }
    });

    each(pathLayers, ({ layer }) => {
      this.map.removeLayer(layer);
    });

    each(markerLayers, ({ layer }) => {
      this.map.removeLayer(layer);
    });
  }

  selectMarkers({ id }) {
    const layer = this.layersLookup[id];

    if (layer) {
      let bounds;

      if (layer instanceof L.Marker) {
        bounds = L.latLngBounds([layer.getLatLng()]);
      } else {
        bounds = layer.getBounds();
      }
      this.map.fitBounds(bounds);
    }
  }

  setMapView({ lat, lng, zoom }) {
    this.map.setView([lat, lng], zoom);
  }
}
