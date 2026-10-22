import PandaBridge from 'pandasuite-bridge';

import * as L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { OpenStreetMapProvider, GeoSearchControl } from 'leaflet-geosearch';
import 'leaflet.locatecontrol';

import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet-geosearch/dist/geosearch.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.min.css';
import 'font-awesome/css/font-awesome.min.css';
import './css/editor.css';

import each from 'lodash/each';
import findIndex from 'lodash/findIndex';
import find from 'lodash/find';
import isEqual from 'lodash/isEqual';
import keyBy from 'lodash/keyBy';

import {
  getMapOptionsFromProperties,
  getTileLayerOptionsFromProperties,
  geoJSONToLayer,
  patchDefaultIcons,
  setupLayerFromMarker,
  syncMapBoundsFromProperties,
  syncMarkerWithLayer,
  syncWorldCopyJumpFromProperties,
} from './utils/Leaflet';
import { addBounceAnimation } from './utils/Animation';
import { toFixed } from './utils/Math';

patchDefaultIcons();

const generateUniqueId = () => {
  const chr4 = () => Math.random().toString(16).slice(-4);
  return `${
    chr4() + chr4()
  }-${chr4()}-${chr4()}-${chr4()}-${chr4()}${chr4()}${chr4()}`;
};

const reshapeLayer = (layer, data) => {
  const shape = geoJSONToLayer(data);

  if (shape instanceof L.Polyline) {
    layer.setLatLngs(shape.getLatLngs());
    /* Geoman draws its handles from the shape it had when enabled */
    if (layer.pm.enabled()) {
      layer.pm.enable();
    }
    if (layer.pm.rotateEnabled()) {
      layer.pm.enableRotate();
    }
  }
};

export default class LeafletEditor {
  constructor(properties, markers, fitBounds = null) {
    const { center } = properties;

    this.properties = properties;
    this.markers = markers;
    // Guards programmatic map updates from echoing back as PandaBridge.UPDATED
    // (Studio re-sends echoed properties via updateProperties → infinite loop).
    this.isApplyingProperties = false;
    this.map = L.map(
      'map',
      getMapOptionsFromProperties(properties),
    ).setView([center.lat, center.lng], properties.zoom);
    syncMapBoundsFromProperties(this.map, properties);
    this.layersLookup = {};
    this.map.on('resize', () => {
      this.isApplyingProperties = true;
      try {
        syncMapBoundsFromProperties(this.map, this.properties);
      } finally {
        this.isApplyingProperties = false;
      }
    });

    this.setupMapLayer();
    this.setupCenter();
    this.setupGeoSearch();
    this.locate = this.setupLocate();
    this.setupGeoman();
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
    const tileLayerOptions = getTileLayerOptionsFromProperties(
      this.properties,
    );

    switch (this.properties.type) {
      case 'Mapbox':
        return L.tileLayer(
          'https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}',
          {
            ...tileLayerOptions,
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
            ...tileLayerOptions,
            attribution:
              'Map data &copy; <a href="https://www.google.com/maps">Google Maps</a>',
            id: 'google-streets',
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            apiKey: this.properties.googleApiKey,
          },
        );

      default:
        return L.tileLayer(
          'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            ...tileLayerOptions,
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

      this.centerMarker = L.marker([center.lat, center.lng], {
        pmIgnore: true,
      }).addTo(this.map);
    }
  }

  addMarkerFromLayer(layer) {
    const uniqueId = generateUniqueId();

    // eslint-disable-next-line no-param-reassign
    layer.uniqueId = uniqueId;
    const marker = syncMarkerWithLayer({ id: uniqueId }, layer);

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
      syncMarkerWithLayer(marker, layer);
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

    /* Geoman 2.15 enables rotation on every layer added in rotate mode, points
       and layers already removed again included, and both throw. Same filter
       as later releases, plus a check that the layer is still on the map */
    /* eslint-disable no-underscore-dangle */
    this.map.pm.handleLayerAdditionInGlobalRotateMode = function reinitRotate() {
      const layers = this._addedLayersRotate;

      this._addedLayersRotate = {};
      if (this.globalRotateModeEnabled()) {
        each(layers, (layer) => {
          if (layer._map && this._isRelevantForRotate(layer)) {
            layer.pm.enableRotate();
          }
        });
      }
    };
    /* eslint-enable no-underscore-dangle */

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

  setupGeoSearch() {
    const provider = new OpenStreetMapProvider();

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
      this.addLayerFromMarker(marker);
    });
  }

  addLayerFromMarker(marker) {
    const layer = geoJSONToLayer(marker.data);

    if (layer) {
      setupLayerFromMarker(layer, marker);
      layer.addTo(this.map);
      this.attachEventsToLayer(layer);
    }
  }

  setupHooks() {
    this.map.on('moveend', () => {
      const center = this.map.getCenter();

      if (this.centerMarker) {
        this.centerMarker.setLatLng(new L.LatLng(center.lat, center.lng));
      }

      if (this.isApplyingProperties) {
        return;
      }

      PandaBridge.send(PandaBridge.UPDATED, {
        properties: [
          {
            id: 'center',
            value: {
              lat: toFixed(center.lat, 6),
              lng: toFixed(center.lng, 6),
            },
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
    const { center, zoom } = this.properties;
    const mapBoundsChanged =
      center.lat !== properties.center.lat ||
      center.lng !== properties.center.lng ||
      zoom !== properties.zoom;

    this.isApplyingProperties = true;
    try {
      this.properties = properties;
      syncWorldCopyJumpFromProperties(this.map, properties);
      syncMapBoundsFromProperties(this.map, properties);
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
    } finally {
      this.isApplyingProperties = false;
    }
  }

  updateMarkers(markers) {
    const previous = keyBy(this.markers, 'id');
    const layers = {};

    this.markers = markers;

    this.map.eachLayer((layer) => {
      if (layer.uniqueId) {
        layers[layer.uniqueId] = layer;
      }
    });

    each(this.markers, (marker) => {
      const layer = layers[marker.id];

      delete layers[marker.id];
      if (!layer) {
        this.addLayerFromMarker(marker);
        return;
      }
      /* A path's shape lives in its data only. The previous data already
         holds what this editor sent, so its echo leaves a gesture alone */
      if (
        layer instanceof L.Polyline &&
        previous[marker.id] &&
        !isEqual(previous[marker.id].data, marker.data)
      ) {
        reshapeLayer(layer, marker.data);
      }
      setupLayerFromMarker(layer, marker);
    });

    each(layers, (layer) => {
      this.map.removeLayer(layer);
    });
  }

  selectMarkers({ id }) {
    // eslint-disable-next-line no-unused-vars
    const layer = this.layersLookup[id];

    addBounceAnimation(layer);

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

  setMapView({ center, zoom }) {
    this.map.setView([center.lat, center.lng], zoom, { animate: false });
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
