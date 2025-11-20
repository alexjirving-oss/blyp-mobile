// Minimal RNGH shim to keep app stable when native module is disabled.
// Security & Stability first: avoid throwing; provide safe fallbacks.

import React from 'react';
import { View, ScrollView as RNScrollView, FlatList as RNFlatList, SectionList as RNSectionList } from 'react-native';

export const GestureHandlerRootView = View;
export const gestureHandlerRootHOC = (Comp) => (props) => <Comp {...props} />;

// No-op handler components: render children directly without intercepting gestures
function passthrough({ children, ..._rest }) { return children ?? null; }
export const PanGestureHandler = passthrough;
export const TapGestureHandler = passthrough;
export const LongPressGestureHandler = passthrough;
export const FlingGestureHandler = passthrough;
export const PinchGestureHandler = passthrough;
export const RotationGestureHandler = passthrough;
export const NativeViewGestureHandler = passthrough;
export const ForceTouchGestureHandler = passthrough;
export const HoverGestureHandler = passthrough;

// Export basic enums/consts used by callers
export const State = {};
export const Directions = {};

// Provide scrollable wrappers to maintain parity if imported from RNGH
export const ScrollView = RNScrollView;
export const FlatList = RNFlatList;
export const SectionList = RNSectionList;

// Imperative helpers as safe no-ops
export function attachGestureHandler() {}
export function createGestureHandler() {}
export function dropGestureHandler() {}
export function updateGestureHandler() {}
export function flushOperations() {}

export default {
  GestureHandlerRootView,
  gestureHandlerRootHOC,
  PanGestureHandler,
  TapGestureHandler,
  LongPressGestureHandler,
  FlingGestureHandler,
  PinchGestureHandler,
  RotationGestureHandler,
  NativeViewGestureHandler,
  ForceTouchGestureHandler,
  HoverGestureHandler,
  State,
  Directions,
  ScrollView,
  FlatList,
  SectionList,
  attachGestureHandler,
  createGestureHandler,
  dropGestureHandler,
  updateGestureHandler,
  flushOperations,
};
