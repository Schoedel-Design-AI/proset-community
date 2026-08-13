export interface FloatingRecordOverlaySpec {
  buttonSize: number;
  spotlightSize: number;
  maskSize: number;
  shellSize: number;
  spotlightInnerOpacity: number;
  spotlightOuterOpacity: number;
  maskInnerOpacity: number;
  maskMidOpacity: number;
  maskOuterOpacity: number;
}

export function getFloatingRecordOverlaySpec(buttonSize = 64): FloatingRecordOverlaySpec {
  const spotlightSize = Math.round(buttonSize * 2.75);
  const maskSize = Math.round(buttonSize * 4.5);
  const shellSize = Math.round(buttonSize * 4.9);

  return {
    buttonSize,
    spotlightSize,
    maskSize,
    shellSize,
    spotlightInnerOpacity: 0.94,
    spotlightOuterOpacity: 0,
    maskInnerOpacity: 0.24,
    maskMidOpacity: 0.08,
    maskOuterOpacity: 0,
  };
}