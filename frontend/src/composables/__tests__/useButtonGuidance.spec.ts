import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref, Teleport } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import BaseButton from '@/components/atoms/BaseButton.vue';
import UploadSection from '@/components/molecules/UploadSection.vue';
import { useButtonGuidance } from '../useButtonGuidance';
import { guideRequest, initialGuidance } from '../../../shared/guidance-preference';

const Host = defineComponent({
  components: { BaseButton, UploadSection, Teleport },
  setup() {
    useButtonGuidance();
    return { next: ref(0), closed: ref(0), value: ref('') };
  },
  template: `<div><label>內容<input aria-label="內容" v-model="value" /></label><UploadSection /><BaseButton @click="next++">下一步</BaseButton><p id="next-count">{{next}}</p><Teleport to="body"><button aria-label="關閉" @click="closed++">關閉</button></Teleport><p id="close-count">{{closed}}</p></div>`
});
let dispose: (() => void) | undefined;
const click = (element: Element) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('service form button guidance', () => {
  it('keeps an existing web opt-out when the new native preference has never been configured', () => {
    localStorage.setItem('tp-button-guidance', 'off');
    vi.stubGlobal('__tpButtonGuidance', { enabled: true, lang: 'zh-Hant-TW', configured: false });
    expect(initialGuidance().enabled).toBe(false);
    vi.stubGlobal('__tpButtonGuidance', { enabled: true, lang: 'zh-Hant-TW', configured: true });
    expect(initialGuidance().enabled).toBe(true);
  });
  async function setup() {
    const spoken: string[] = [];
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      }
    );
    vi.stubGlobal('speechSynthesis', {
      cancel: vi.fn(),
      speak: vi.fn((utterance: { text: string }) => spoken.push(utterance.text))
    });
    const wrapper = mount(Host, { global: { plugins: [createPinia()] } });
    document.body.appendChild(wrapper.element);
    dispose = () => wrapper.unmount();
    await flushPromises();
    return { wrapper, spoken };
  }
  it('guides the first next/teleported-close click by default and executes the second exactly once', async () => {
    const { wrapper, spoken } = await setup();
    const next = wrapper.get('button.base-button').element;
    expect(click(next)).toBe(false);
    await flushPromises();
    expect(wrapper.get('#next-count').text()).toBe('0');
    expect(spoken.at(-1)).toContain('下一步');
    click(next);
    await flushPromises();
    expect(wrapper.get('#next-count').text()).toBe('1');
    const close = document.querySelector('[aria-label="關閉"]')!;
    click(close);
    await flushPromises();
    expect(wrapper.get('#close-count').text()).toBe('0');
    click(close);
    await flushPromises();
    expect(wrapper.get('#close-count').text()).toBe('1');
  });
  it('covers the upload label and input without opening the picker on the first tap', async () => {
    const { wrapper, spoken } = await setup();
    const upload = wrapper.get('label.upload-box').element;
    const input = wrapper.get('input[type="file"]').element;
    const picked = vi.fn();
    input.addEventListener('click', picked);
    click(upload);
    expect(picked).not.toHaveBeenCalled();
    expect(spoken.at(-1)).toContain('附件');
    click(upload);
    expect(picked).toHaveBeenCalledOnce();
    const text = wrapper.get('input[aria-label="內容"]').element;
    expect(
      text.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      )
    ).toBe(false);
    click(text);
    expect(spoken.at(-1)).toContain('輸入或修改');
    expect(
      text.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      )
    ).toBe(true);
  });
  it('keeps native keyboard activation available', async () => {
    const { wrapper } = await setup();
    wrapper
      .get('button.base-button')
      .element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    await flushPromises();
    expect(wrapper.get('#next-count').text()).toBe('1');
  });
  it('pairs concurrent legacy bridge replies and restores the previous listener', async () => {
    const previous = vi.fn();
    const requests: { name: string; data: { requestId: string } }[] = [];
    const bridge = {
      onmessage: previous as ((event: { data: string }) => void) | null,
      postMessage(raw: string) {
        requests.push(JSON.parse(raw));
      }
    };
    vi.stubGlobal('flutterObject', bridge);
    const first = guideRequest('button_guidance');
    const second = guideRequest('a11y_state');
    const reply = (index: number) =>
      bridge.onmessage?.({
        data: JSON.stringify({
          name: requests[index].name,
          data: { requestId: requests[index].data.requestId, ok: true }
        })
      });
    reply(1);
    expect(await second).toHaveProperty('ok', true);
    reply(0);
    expect(await first).toHaveProperty('ok', true);
    expect(bridge.onmessage).toBe(previous);
  });
});
