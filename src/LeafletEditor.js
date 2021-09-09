import PandaBridge from 'pandasuite-bridge';

import * as L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { AlgoliaProvider, GeoSearchControl } from 'leaflet-geosearch';
import 'leaflet.locatecontrol';

import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet-geosearch/dist/geosearch.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.min.css';
import 'font-awesome/css/font-awesome.min.css';

import each from 'lodash/each';
import findIndex from 'lodash/findIndex';
import find from 'lodash/find';

import {
  geoJSONToLayer, layerToGeoJSON, patchDefaultIcons, setupLayerFromMarker,
} from './utils/Leaflet';

patchDefaultIcons();

const generateUniqueId = () => {
  const chr4 = () => Math.random().toString(16).slice(-4);
  return `${chr4() + chr4()}-${chr4()}-${chr4()}-${chr4()}-${chr4()}${chr4()}${chr4()}`;
};

export default class LeafletEditor {
  constructor(properties, markers) {
    this.properties = properties;
    this.markers = markers;
    this.map = L.map('map').setView([properties.lat, properties.lng], properties.zoom);
    this.layersLookup = {};

    this.setupMapLayer();
    this.setupCenter();
    this.setupGeoSearch();
    this.locate = this.setupLocate();
    this.setupGeoman();
    this.setupMarkers();
    this.setupHooks();
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
        return L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
          attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
          id: this.getMapBoxStyle().replace('mapbox://styles/', ''),
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

  setupCenter() {
    if (this.properties.centerMarker) {
      this.centerMarker = L.marker([
        this.properties.lat,
        this.properties.lng,
      ], { pmIgnore: true }).addTo(this.map);
    }
  }

  addMarkerFromLayer(layer) {
    const uniqueId = generateUniqueId();

    // eslint-disable-next-line no-param-reassign
    layer.uniqueId = uniqueId;
    const marker = {
      id: uniqueId,
      data: layerToGeoJSON(layer),
    };
    this.markers.push(marker);

    /* Don't pass an array for updating only the existing marker */
    PandaBridge.send(PandaBridge.UPDATED, { markers: marker });

    this.attachEventsToLayer(layer);
  }

  removeMarkerFromLayer(layer) {
    const markerIndex = findIndex(this.markers, ['id', layer.uniqueId]);

    if (markerIndex !== -1) {
      this.markers.splice(markerIndex, 1);
      PandaBridge.send(PandaBridge.UPDATED, { markers: this.markers });
    }
  }

  updateMarkerFromLayer(layer) {
    const marker = find(this.markers, ['id', layer.uniqueId]);

    if (marker) {
      marker.data = layerToGeoJSON(layer);
      PandaBridge.send(PandaBridge.UPDATED, { markers: marker });
    }
  }

  selectMarkerFromLayer(layer) {
    const marker = find(this.markers, ['id', layer.uniqueId]);

    if (marker) {
      PandaBridge.send(PandaBridge.UPDATED, { markers: marker });
    }
  }

  attachEventsToLayer(layer) {
    this.layersLookup[layer.uniqueId] = layer;

    layer.on('pm:edit', (editEvent) => {
      // eslint-disable-next-line no-underscore-dangle
      if (editEvent.layer._map) {
        this.updateMarkerFromLayer(editEvent.layer);
      } else {
        /* Cut trigger an edit for removed element */
        layer.off('pm:edit');
        layer.off('pm:cut');
        layer.off('pm:click');
      }
    });

    layer.on('pm:cut', (cutEvent) => {
      let newLayer;

      if (cutEvent.layer.getLayers) {
        const layers = cutEvent.layer.getLayers();
        // eslint-disable-next-line prefer-destructuring
        newLayer = layers[0];
        each(layers.slice(1), (childLayer) => {
          this.addMarkerFromLayer(childLayer);
        });
      } else {
        newLayer = cutEvent.layer;
      }
      newLayer.uniqueId = cutEvent.originalLayer.uniqueId;
      this.updateMarkerFromLayer(newLayer);
      this.attachEventsToLayer(newLayer);
    });

    layer.on('click', (e) => {
      this.selectMarkerFromLayer(e.target);
    });
  }

  setupGeoman() {
    this.map.pm.addControls({
      position: 'topleft',
      drawMarker: true,
    });

    this.map.on('pm:create', (e) => {
      this.addMarkerFromLayer(e.layer);
    });

    this.map.on('pm:remove', (e) => {
      this.removeMarkerFromLayer(e.layer);
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

  setupGeoSearch() {
    const provider = new AlgoliaProvider();

    this.map.addControl(
      new GeoSearchControl({
        style: 'bar',
        provider,
        showMarker: false,
      }),
    );
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

      if (this.centerMarker) {
        this.centerMarker.setLatLng(new L.LatLng(center.lat, center.lng));
      }

      PandaBridge.send(PandaBridge.UPDATED, {
        properties: [
          {
            id: 'lat',
            value: center.lat,
          },
          {
            id: 'lng',
            value: center.lng,
          },
          {
            id: 'zoom',
            value: this.map.getZoom(),
          },
        ],
      });
    });
  }

  updateProperties(properties) {
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
    // eslint-disable-next-line no-unused-vars
    const layer = this.layersLookup[id];

    // if (layer) {
    //   let bounds;

    //   if (layer instanceof L.Marker) {
    //     bounds = L.latLngBounds([layer.getLatLng()]);
    //   } else {
    //     bounds = layer.getBounds();
    //   }
    //   this.map.fitBounds(bounds);
    // }
  }

  setMapView({ lat, lng, zoom }) {
    this.map.setView([lat, lng], zoom);
  }
}
