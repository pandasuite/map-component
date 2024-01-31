/* eslint-disable no-param-reassign */
/* eslint-disable no-underscore-dangle */
import * as L from 'leaflet';

import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

import isEmpty from 'lodash/isEmpty';
import pickBy from 'lodash/pickBy';
import { toFixed } from './Math';

export const patchDefaultIcons = () => {
  // eslint-disable-next-line no-underscore-dangle
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl,
    iconUrl,
    shadowUrl,
  });
};

const extractStyle = (marker) => {
  const { color, weight, opacity, fillColor, fillOpacity } = marker;
  const style = pickBy(
    {
      color,
      weight,
      opacity,
      fillColor,
      fillOpacity,
    },
    (v) => v !== undefined && v !== null,
  );

  if (isEmpty(style)) {
    return null;
  }
  return style;
};

export const setupLayerFromMarker = (layer, marker) => {
  // eslint-disable-next-line no-param-reassign
  layer.uniqueId = marker.id;

  const {
    customIcon,
    iconUrl: iconUrlMarker,
    iconWidth = 25,
    iconHeight = 41,
    iconAnchorX = 12,
    iconAnchorY = 41,
    latlng: { lat, lng } = {},
    radius,
    showPopup,
    popup,
  } = marker;

  if (layer instanceof L.Marker) {
    if (customIcon && !isEmpty(iconUrlMarker)) {
      layer.setIcon(
        L.icon({
          iconUrl: iconUrlMarker,
          iconSize: [iconWidth, iconHeight],
          iconAnchor: [iconAnchorX, iconAnchorY],
        }),
      );
    } else if (!customIcon && !(layer.getIcon() instanceof L.Icon.Default)) {
      layer.setIcon(new L.Icon.Default());
    }
    if (lat && lng) {
      layer.setLatLng([lat, lng]);
    }
  } else if (layer instanceof L.Circle || layer instanceof L.CircleMarker) {
    if (lat && lng) {
      layer.setLatLng([lat, lng]);
    }
    if (radius) {
      layer.setRadius(radius);
    }
  }

  if (layer instanceof L.Path) {
    const style = extractStyle(marker);

    if (style) {
      layer.setStyle(style);
    }
  }

  if (showPopup) {
    layer.bindPopup(popup);
  } else {
    layer.unbindPopup();
  }
};

export const layerToGeoJSON = (layer) => {
  const geoJson = JSON.parse(JSON.stringify(layer.toGeoJSON()));

  if (!geoJson.properties) {
    geoJson.properties = {};
  }

  geoJson.properties.options = JSON.parse(JSON.stringify(layer.options));

  if (layer.options.radius) {
    const radius = parseFloat(layer.options.radius);
    if (radius % 1 !== 0) {
      geoJson.properties.options.radius = radius.toFixed(6);
    } else {
      geoJson.properties.options.radius = radius.toFixed(0);
    }
  }

  if (layer instanceof L.Rectangle) {
    geoJson.properties.type = 'rectangle';
  } else if (layer instanceof L.Circle) {
    geoJson.properties.type = 'circle';
  } else if (layer instanceof L.CircleMarker) {
    geoJson.properties.type = 'circlemarker';
  } else if (layer instanceof L.Polygon) {
    geoJson.properties.type = 'polygon';
  } else if (layer instanceof L.Polyline) {
    geoJson.properties.type = 'polyline';
  } else if (layer instanceof L.Marker) {
    geoJson.properties.type = 'marker';
  }
  return geoJson;
};

export const geoJSONToLayer = (geo) => {
  const collection = {
    type: 'FeatureCollection',
    features: [geo],
  };

  const geoLayer = L.geoJSON(collection, {
    style(feature) {
      if (feature && feature.properties && feature.properties.options) {
        return feature.properties.options;
      }
      return {};
    },
    pointToLayer(feature, latlng) {
      switch (feature.properties.type) {
        case 'marker':
          return new L.Marker(latlng);
        case 'circle':
          return new L.Circle(latlng, feature.properties.options);
        case 'circlemarker':
          return new L.CircleMarker(latlng, feature.properties.options);
        default:
          return null;
      }
    },
  });

  const layer = geoLayer.getLayers()[0];
  let latlng;

  if (layer._latlng) {
    latlng = layer.getLatLng();
  } else {
    latlng = layer.getLatLngs();
  }
  switch (layer.feature.properties.type) {
    case 'rectangle':
      return new L.Rectangle(latlng, layer.options);
    case 'circle':
      return new L.Circle(latlng, layer.options);
    case 'polygon':
      return new L.Polygon(latlng, layer.options);
    case 'polyline':
      return new L.Polyline(latlng, layer.options);
    case 'marker':
      return new L.Marker(latlng, layer.options);
    case 'circlemarker':
      return new L.CircleMarker(latlng, layer.options);
    default:
      return null;
  }
};

export const syncMarkerWithLayer = (marker, layer) => {
  marker.data = layerToGeoJSON(layer);

  if (
    layer instanceof L.Marker ||
    layer instanceof L.Circle ||
    layer instanceof L.CircleMarker
  ) {
    const { lat, lng } = layer.getLatLng();

    marker.latlng = {
      lat: toFixed(lat, 6),
      lng: toFixed(lng, 6),
    };
  }

  if (layer instanceof L.Circle || layer instanceof L.CircleMarker) {
    marker.radius = layer.getRadius();
  }

  return marker;
};
