import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';

import AboutView from '@/views/AboutView.vue';
import { DEMO_DATA_SOURCES, OPEN_DATA_LICENSE_URL, OPEN_DATA_SOURCES } from '../dataSources';

describe('data sources', () => {
  it('every open data source has an agency and an https link', () => {
    for (const source of OPEN_DATA_SOURCES) {
      expect(source.agency).not.toBe('');
      expect(source.url.startsWith('https://')).toBe(true);
    }
  });

  it('about page lists sources, the demo label and the license link', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div />' } }]
    });
    const wrapper = mount(AboutView, { global: { plugins: [router] } });
    const text = wrapper.text();
    expect(text).toContain(OPEN_DATA_SOURCES[0].name);
    expect(text).toContain('示範資料');
    expect(text).toContain('政府資料開放授權條款－第1版');
    expect(wrapper.find(`a[href="${OPEN_DATA_LICENSE_URL}"]`).exists()).toBe(true);
    expect(DEMO_DATA_SOURCES.length).toBeGreaterThan(0);
  });
});
