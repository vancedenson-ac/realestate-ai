/**
 * Manual mock for react-map-gl (ESM package that Jest CJS resolver can't auto-resolve).
 * Provides stub components for tests that render map UI.
 */
const React = require("react");

const Map = React.forwardRef(function MockMap(props, ref) {
  const { children, onLoad, onMoveEnd, onClick, ...rest } = props;
  React.useEffect(() => {
    if (onLoad) {
      onLoad({
        target: {
          getBounds: () => ({
            getSouthWest: () => ({ lat: 30.2, lng: -97.8 }),
            getNorthEast: () => ({ lat: 30.45, lng: -97.7 }),
          }),
          getZoom: () => 12,
          getCanvas: () => ({ style: {} }),
          flyTo: () => {},
        },
      });
    }
  }, [onLoad]);
  return React.createElement("div", { "data-testid": "mock-map", ref }, children);
});

function Source(props) {
  return React.createElement("div", { "data-testid": "mock-source" }, props.children);
}

function Layer(props) {
  return React.createElement("div", { "data-testid": "mock-layer-" + (props.id || "unknown") });
}

function Popup(props) {
  return React.createElement("div", { "data-testid": "mock-popup" }, props.children);
}

function NavigationControl() {
  return React.createElement("div", { "data-testid": "mock-nav-control" });
}

function GeolocateControl() {
  return React.createElement("div", { "data-testid": "mock-geolocate-control" });
}

module.exports = {
  __esModule: true,
  default: Map,
  Source,
  Layer,
  Popup,
  NavigationControl,
  GeolocateControl,
};
