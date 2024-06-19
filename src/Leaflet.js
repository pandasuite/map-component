import PandaBridge from 'pandasuite-bridge';

import * as L from 'leaflet';
import 'leaflet.locatecontrol';

import 'leaflet/dist/leaflet.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.min.css';
import 'font-awesome/css/font-awesome.min.css';

import each from 'lodash/each';

import {
  geoJSONToLayer,
  patchDefaultIcons,
  setupLayerFromMarker,
} from './utils/Leaflet';

patchDefaultIcons();

export default class Leaflet {
  constructor(properties, markers, fitBounds = null) {
    const { center } = properties;

    this.properties = properties;
    this.markers = markers;
    this.map = L.map('map').setView([center.lat, center.lng], properties.zoom);
    this.layersLookup = {};

    this.setupMapLayer();
    this.setupCenter();
    this.locate = this.setupLocate();
    this.setupMarkers();
    this.setupHooks();
    if (fitBounds) {
      this.fitMapView({ ...fitBounds, animate: false });
    }
  }

  getMapBoxStyle() {
    let style = this.properties.mapboxStyle;

    if (style === 'custom') {
      style = this.properties.mapboxStyleCustom;
    }
    return style.replace('mapbox://styles/', '');
  }

  getTileLayerFromProps() {
    switch (this.properties.type) {
      case 'Mapbox':
        return L.tileLayer(
          'https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}',
          {
            attribution:
              'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
            id: this.getMapBoxStyle().replace('mapbox://styles/', ''),
            tileSize: 512,
            zoomOffset: -1,
            accessToken: this.properties.mapboxAccessToken,
          },
        );

      case 'GoogleMaps':
        return L.tileLayer(
          'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}?key={apiKey}',
          {
            id: 'google-streets',
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            attribution:
              'Map data &copy; <a href="https://www.google.com/maps">Google Maps</a>',
            apiKey: this.properties.googleApiKey,
          },
        );

      default:
        return L.tileLayer(
          'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        );
    }
  }

  setupMapLayer() {
    this.mapLayer = this.getTileLayerFromProps();
    this.mapLayer.addTo(this.map);
  }

  setupCenter() {
    if (this.properties.centerMarker) {
      const { center } = this.properties;

      this.centerMarker = L.marker([center.lat, center.lng]).addTo(this.map);
    }
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
          setView:
            this.properties.setView === 'false'
              ? false
              : this.properties.setView,
        },
      });
      this.map.addControl(locate);
      return locate;
    }
    return null;
  }

  setupMarkers() {
    this.markers.forEach((marker) => {
      if (marker.visible === false) {
        return;
      }
      const layer = geoJSONToLayer(marker.data);

      if (layer) {
        setupLayerFromMarker(layer, marker);
        layer.addTo(this.map);
        this.attachEventsToLayer(layer);
      }
    });
  }

  setupHooks() {
    this.map.on('moveend', () => {
      const center = this.map.getCenter();

      if (this.centerMarker) {
        this.centerMarker.setLatLng(new L.LatLng(center.lat, center.lng));
      }

      const schema = {
        center: {
          type: 'Coord',
          value: {
            lat: center.lat,
            lng: center.lng,
          },
        },
        zoom: this.map.getZoom(),
      };

      PandaBridge.send('mapChanged', [schema]);
      PandaBridge.send(PandaBridge.UPDATED, {
        queryable: schema,
      });
    });
  }

  updateProperties(properties) {
    const { center, zoom } = this.properties;
    const mapBoundsChanged =
      center.lat !== properties.center.lat ||
      center.lng !== properties.center.lng ||
      zoom !== properties.zoom;

    this.properties = properties;
    this.map.removeLayer(this.mapLayer);
    if (this.centerMarker) {
      this.map.removeLayer(this.centerMarker);
    }
    if (this.locate) {
      this.map.removeControl(this.locate);
    }
    this.setupMapLayer();
    this.setupCenter();
    if (mapBoundsChanged) {
      this.setMapView(properties);
    }
    this.locate = this.setupLocate();
  }

  updateMarkers(markers) {
    const markerLayers = {};
    const pathLayers = {};
    const otherLayers = {};

    this.markers = markers;

    this.map.eachLayer((layer) => {
      if (layer.uniqueId) {
        if (layer instanceof L.Marker) {
          markerLayers[layer.uniqueId] = { layer };
        } else if (layer instanceof L.Path) {
          pathLayers[layer.uniqueId] = { layer };
        } else {
          otherLayers[layer.uniqueId] = { layer };
        }
      }
    });

    each(this.markers, (marker) => {
      if (marker.visible === false) {
        return;
      }
      if (markerLayers[marker.id]) {
        const { layer } = markerLayers[marker.id];

        setupLayerFromMarker(layer, marker);
        delete markerLayers[marker.id];
      } else if (pathLayers[marker.id]) {
        const { layer } = pathLayers[marker.id];

        setupLayerFromMarker(layer, marker);
        delete pathLayers[marker.id];
      } else {
        const layer = geoJSONToLayer(marker.data);

        if (layer) {
          setupLayerFromMarker(layer, marker);
          if (otherLayers[marker.id]) {
            this.map.removeLayer(otherLayers[marker.id].layer);
            delete otherLayers[marker.id];
          }
          layer.addTo(this.map);
          this.attachEventsToLayer(layer);
        }
      }
    });

    each(pathLayers, ({ layer }) => {
      this.map.removeLayer(layer);
    });

    each(markerLayers, ({ layer }) => {
      this.map.removeLayer(layer);
    });

    each(otherLayers, ({ layer }) => {
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

  setMapView({ center, zoom }) {
    this.map.setView([center.lat, center.lng], zoom);
  }

  fitMapView(options = {}) {
    const bounds = new L.LatLngBounds();

    this.map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Path) {
        bounds.extend(layer.getBounds ? layer.getBounds() : layer.getLatLng());
      }
    });

    if (bounds.isValid()) {
      this.map.fitBounds(bounds, options);
    }
  }
}
