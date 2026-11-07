import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import FontSizeControl from '../FontSizeControl.vue';
import { initFontSize } from '@/composables/useFontSize';

describe('FontSizeControl', () => {
  beforeEach(() => {
    localStorage.clear();
    initFontSize();
  });

  it('is collapsed by default and exposes its state', async () => {
    const wrapper = mount(FontSizeControl);
    const toggle = wrapper.get('button[aria-controls="font-size-panel"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('#font-size-panel').exists()).toBe(false);
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.findAll('#font-size-panel button').length).toBeGreaterThanOrEqual(3);
  });

  it('marks the chosen level with aria-pressed and applies it', async () => {
    const wrapper = mount(FontSizeControl);
    await wrapper.get('button[aria-controls="font-size-panel"]').trigger('click');
    const buttons = wrapper.findAll('#font-size-panel button');
    expect(buttons[0].attributes('aria-pressed')).toBe('true');
    await buttons[1].trigger('click');
    expect(buttons[1].attributes('aria-pressed')).toBe('true');
    expect(buttons[0].attributes('aria-pressed')).toBe('false');
    expect(document.documentElement.style.fontSize).toBe('125%');
    expect(localStorage.getItem('townpass.fontSize')).toBe('large');
  });
});
