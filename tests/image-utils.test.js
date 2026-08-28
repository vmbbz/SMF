import { isDrawableImage } from '../src/image-utils.js';

describe('isDrawableImage', () => {
  test('accepts a completely loaded image with real intrinsic dimensions', () => {
    expect(isDrawableImage({ complete: true, naturalWidth: 192, naturalHeight: 192 })).toBe(true);
  });

  test('rejects loading and completed-but-broken images', () => {
    expect(isDrawableImage({ complete: false, naturalWidth: 192, naturalHeight: 192 })).toBe(false);
    expect(isDrawableImage({ complete: true, naturalWidth: 0, naturalHeight: 0 })).toBe(false);
  });

  test('supports image-like test doubles that expose rendered dimensions', () => {
    expect(isDrawableImage({ complete: true, width: 64, height: 64 })).toBe(true);
    expect(isDrawableImage(null)).toBe(false);
  });
});
