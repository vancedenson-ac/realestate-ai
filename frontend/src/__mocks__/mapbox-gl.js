/**
 * Manual mock for mapbox-gl (requires WebGL — unavailable in jsdom test environment).
 */
module.exports = {
  Map: jest.fn(),
  Popup: jest.fn(),
  NavigationControl: jest.fn(),
  GeolocateControl: jest.fn(),
  Marker: jest.fn(),
  LngLat: jest.fn(),
  LngLatBounds: jest.fn(),
};
