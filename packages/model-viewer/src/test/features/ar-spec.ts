/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {IS_IOS} from '../../constants.js';
import {$openIOSARQuickLook, $openSceneViewer, AndroidIntent, AndroidIntentParameters, ARInterface, ARMixin, IOSIntent, IOSIntentParameters} from '../../features/ar.js';
import ModelViewerElementBase from '../../model-viewer-base.js';
import {Constructor, timePasses, waitForEvent} from '../../utilities.js';
import {assetPath, spy} from '../helpers.js';
import {BasicSpecTemplate} from '../templates.js';

const expect = chai.expect;

suite('ModelViewerElementBase with ARMixin', () => {
  suite('when registered', () => {
    let nextId = 0;
    let tagName: string;
    let ModelViewerElement: Constructor<ModelViewerElementBase&ARInterface>;

    setup(() => {
      tagName = `model-viewer-ar-${nextId++}`;
      ModelViewerElement = class extends ARMixin
      (ModelViewerElementBase) {
        static get is() {
          return tagName;
        }
      };
      customElements.define(tagName, ModelViewerElement);
    });

    BasicSpecTemplate(() => ModelViewerElement, () => tagName);

    suite('AR intents', () => {
      let element: ModelViewerElementBase&ARInterface;
      let intentUrls: Array<string>;
      let restoreAnchorClick: () => void;

      setup(() => {
        element = new ModelViewerElement();
        document.body.insertBefore(element, document.body.firstChild);
        intentUrls = [];
        restoreAnchorClick = spy(HTMLAnchorElement.prototype, 'click', {
          value: function() {
            intentUrls.push((this as HTMLAnchorElement).href);
          }
        });
      });

      teardown(() => {
        if (element.parentNode != null) {
          element.parentNode.removeChild(element);
        }
        restoreAnchorClick();
      });

      suite('openSceneViewer', () => {
        test('preserves query parameters in model URLs', () => {
          let parameters = new AndroidIntentParameters("Title", "https://example.com/");
          let intent = new AndroidIntent(new URL('https://example.com/model.gltf?token=foo'), parameters);
          console.warn(intent.toURL());

          (element as any)[$openSceneViewer](intent);

          expect(intentUrls.length).to.be.equal(1);

          const search = new URLSearchParams(new URL(intentUrls[0]).search);

          expect(search.get('token')).to.equal('foo');
        });

        test('keeps title and link when supplied', () => {
          let parameters = new AndroidIntentParameters("bar", undefined, undefined, new URL("http://linkme.com"));
          let intent = new AndroidIntent(new URL('https://example.com/model.gltf'), parameters);

          (element as any)[$openSceneViewer](intent);

          expect(intentUrls.length).to.be.equal(1);

          const search = new URLSearchParams(new URL(intentUrls[0]).search);

          expect(search.get('title')).to.equal('bar');
          expect(search.get('link')).to.equal('http://linkme.com/');
        });

        test('sets sound and link to absolute URLs', () => {
          let parameters = new AndroidIntentParameters("bar", undefined, undefined, new URL("foo.html"), "bar.ogg");
          let intent = new AndroidIntent(new URL('https://example.com/model.gltf'), parameters);
          (element as any)[$openSceneViewer](intent);

          expect(intentUrls.length).to.be.equal(1);

          const search = new URLSearchParams(new URL(intentUrls[0]).search);

          // Tests run in different locations
          expect(search.get('sound')).to.contain('http://');
          expect(search.get('sound')).to.contain('/bar.ogg');
          expect(search.get('link')).to.contain('http://');
          expect(search.get('link')).to.contain('/foo.html');
        });
      });

      suite('openQuickLook', () => {
        test('sets hash for fixed scale', () => {
          let parameters = new IOSIntentParameters("title", "subtitle", "price", false);
          let intent = new IOSIntent(new URL('https://example.com/model.usdz'), parameters);
          (element as any)[$openIOSARQuickLook](intent);

          expect(intentUrls.length).to.be.equal(1);

          const url = new URL(intentUrls[0]);

          expect(url.pathname).equal('/model.usdz');
          expect(url.hash).to.contains('allowsContentScaling=0');
        });

        test('keeps original hash too', () => {
          let parameters = new IOSIntentParameters("title", "subtitle", "price", false, undefined, undefined, undefined, "path-to-banner.html");
          let intent = new IOSIntent(new URL('https://example.com/model.usdz'), parameters);
          (element as any)[$openIOSARQuickLook](intent);

          expect(intentUrls.length).to.be.equal(1);

          const url = new URL(intentUrls[0]);

          expect(url.pathname).equal('/model.usdz');
          expect(url.hash).to.contains('custom=path-to-banner.html');
          expect(url.hash).to.contains('allowsContentScaling=0');
        });
      });
    });

    suite('with webxr', () => {
      let element: ModelViewerElementBase&ARInterface;

      setup(async () => {
        element = new ModelViewerElement();
        document.body.insertBefore(element, document.body.firstChild);

        element.ar = true;
        element.arModes = 'webxr';
        element.src = assetPath('models/Astronaut.glb');

        await waitForEvent(element, 'load');
      });

      teardown(() => {
        if (element.parentNode != null) {
          element.parentNode.removeChild(element);
        }
      });

      test('hides the AR button if not on AR platform', () => {
        expect(element.canActivateAR).to.be.equal(false);
      });

      test('shows the AR button if on AR platform');
    });

    suite('ios-src', () => {
      let element: ModelViewerElementBase&ARInterface;

      setup(async () => {
        element = new ModelViewerElement();
        document.body.insertBefore(element, document.body.firstChild);

        element.ar = true;
        element.src = assetPath('models/Astronaut.glb');

        await waitForEvent(element, 'load');
      });

      teardown(() => {
        if (element.parentNode != null) {
          element.parentNode.removeChild(element);
        }
      });

      if (IS_IOS) {
        suite('on iOS Safari', () => {
          test('hides the AR button', () => {
            expect(element.canActivateAR).to.be.equal(false);
          });

          suite('with an ios-src', () => {
            setup(async () => {
              element.iosSrc = assetPath('models/Astronaut.usdz');
              await timePasses();
            });

            test('shows the AR button', () => {
              expect(element.canActivateAR).to.be.equal(true);
            });
          });
        });
      } else {
        suite('on browsers that are not iOS Safari', () => {
          test('hides the AR button', () => {
            expect(element.canActivateAR).to.be.equal(false);
          });

          suite('with an ios-src', () => {
            setup(async () => {
              element.iosSrc = assetPath('models/Astronaut.usdz');
              await timePasses();
            });

            test('still hides the AR button', () => {
              expect(element.canActivateAR).to.be.equal(false);
            });
          });
        });
      }
    });
  });
});
