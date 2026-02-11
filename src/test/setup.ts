import '@testing-library/jest-dom'

// Polyfill atob/btoa for jsdom environment
if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (data: string) => Buffer.from(data, 'base64').toString('binary')
}
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (data: string) => Buffer.from(data, 'binary').toString('base64')
}
