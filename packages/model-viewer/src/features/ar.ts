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

import {property} from 'lit-element';
import {Event as ThreeEvent} from 'three';

import {IS_AR_QUICKLOOK_CANDIDATE, IS_SCENEVIEWER_CANDIDATE, IS_WEBXR_AR_CANDIDATE} from '../constants.js';
import ModelViewerElementBase, {$loaded, $needsRender, $renderer, $scene, $shouldAttemptPreload, $updateSource} from '../model-viewer-base.js';
import {enumerationDeserializer} from '../styles/deserializers.js';
import {ARStatus} from '../three-components/ARRenderer.js';
import {Constructor, waitForEvent} from '../utilities.js';

export interface ARIntentParameters {
  title: string;
  resizable?: boolean;
  link?: URL;
  toURL: () => string;
}

export interface ARIntent {
  parameters: ARIntentParameters;
  file: URL;
  toURL: () => string;
}

export class ARIntentEventDetails {
  constructor(public intent: ARIntent, public originalEvent: Event) {};
}

export enum ApplePayButtonType {
  PLAIN = "plain",
  PAY = "pay",
  BUY = "buy",
  CHECK_OUT = "check-out",
  BOOK = "book",
  DONATE = "donate",
  SUBSCRIBE = "subscribe"
}

export enum AppleCustomBannerHeight {
  SMALL = "small",
  MEDIUM = "medium",
  LARGE = "large"
}

export class IOSIntentParameters implements ARIntentParameters {
  constructor(public title: string,
    public checkoutSubtitle: string,
    public price: string,
    public resizable?: boolean,
    public link?: URL,
    public applePayButtonType?: ApplePayButtonType,
    public callToAction?: string,
    public custom?: string,
    public customHeight?: AppleCustomBannerHeight) {};

  toURL = () => {
    if (!this.applePayButtonType && !this.callToAction) {
      console.warn("Missing either `applePayButtonType` or `callToAction` for the button to appear");
    }
    let mapKeys: any = {
      title: "checkoutTitle",
      resizable: "allowsContentScaling",
      link: "canonicalWebPageURL"
    };
    return Object.entries(this)
      .filter(([, value]) => value !== undefined && typeof(value) !== "function" && value.toString() && value.toString().length > 0)
      .map(([key, value]) => (mapKeys[key] || key.toString()) + "=" + encodeURIComponent(value.toString()))
      .join("&");
  }
}

export enum AndroidARIntentMode {
  "3D_PREFERRED" = "3d_preferred",
  "3D_ONLY" = "3d_only",
  AR_PREFERRED = "ar_preferred",
  AR_ONLY = "ar_only"
}

export class AndroidIntentParameters implements ARIntentParameters {
  constructor(public title: string,
    public fallbackURL?: string,
    public resizable?: boolean,
    public link?: URL,
    public sound?: string) {};

  toURL = () => {
    /*return Object.entries(this)
      .filter(([, value]) => value !== undefined && typeof(value) !== "function" && value.toString() && value.toString().length > 0)
      .map(([key, value]) => key.toString() + "=" + encodeURIComponent(value.toString()))
      .join("&");

*/
    if (this.link && (!this.link?.toString().includes("http://") || !this.link?.toString().includes("https://"))) {
      this.link = new URL(this.link.toString(), self.location.toString());
    }
    if (this.sound && (!this.sound?.includes("http://") || !this.sound?.includes("https://"))) {
      this.sound = new URL(this.sound, self.location.toString()).toString();
    }
    let mapKeys: any = {
      title: "checkoutTitle",
      resizable: "allowsContentScaling",
      link: "canonicalWebPageURL"
    };
    return Object.entries(this)
      .filter(([, value]) => value !== undefined && typeof(value) !== "function" && value.toString() && value.toString().length > 0)
      .map(([key, value]) => (mapKeys[key] || key.toString()) + "=" + encodeURIComponent(value.toString()))
      .join("&");
  }
}

export class IOSIntent implements ARIntent {
  constructor(public file: URL, public parameters: IOSIntentParameters) {};

  toURL = () => {
    const url = this.file;
    url.hash = this.parameters.toURL();
    return url.toString();
  };
}

export class AndroidIntent implements ARIntent {
  constructor(public file: URL, public parameters: AndroidIntentParameters) {};

  toURL = () => {
    let intent = "intent://arvr.google.com/scene-viewer/1.0"
    let params = {
      file: this.file.toString(),
      mode: AndroidARIntentMode.AR_ONLY,
      link: this.parameters.link,
      title: encodeURIComponent(this.parameters.title),
      resizable: this.parameters.resizable
    };
    let fileParams = this.file.searchParams.toString();
    let paramString = [fileParams, ...Object.entries(params)
      .filter(([, value]) => value !== undefined && typeof(value) !== "function" && value.toString() && value.toString().length > 0)
      .map(([key, value]) => key.toString() + "=" + value)]
      .join("&");

    const scheme = this.file.protocol.replace(":", "");
    let hashParams = {
      scheme: scheme,
      package: "com.google.ar.core",
      action: "android.intent.action.VIEW",
      "S.browser_fallback_url": this.parameters.fallbackURL ? encodeURIComponent(this.parameters.fallbackURL) : undefined
    };
    let hashString = "Intent;";
    hashString += Object.entries(hashParams)
      .filter(([, value]) => value !== undefined && typeof(value) !== "function" && value.toString() && value.toString().length > 0)
      .map(([key, value]) => key.toString() + "=" + value)
      .join(";");
    hashString += ";end;";

    return `${intent}?${paramString}#${hashString}`;
  }
}
  

let isWebXRBlocked = false;
let isSceneViewerBlocked = false;
const noArViewerSigil = '#model-viewer-no-ar-fallback';

export type ARMode = 'quick-look'|'scene-viewer'|'webxr'|'none';

const deserializeARModes = enumerationDeserializer<ARMode>(
    ['quick-look', 'scene-viewer', 'webxr', 'none']);

const DEFAULT_AR_MODES = 'webxr scene-viewer quick-look';

const ARMode: {[index: string]: ARMode} = {
  QUICK_LOOK: 'quick-look',
  SCENE_VIEWER: 'scene-viewer',
  WEBXR: 'webxr',
  NONE: 'none'
};

export interface ARStatusDetails {
  status: ARStatus;
}

const $arButtonContainer = Symbol('arButtonContainer');
const $enterARWithWebXR = Symbol('enterARWithWebXR');
export const $openSceneViewer = Symbol('openSceneViewer');
export const $openIOSARQuickLook = Symbol('openIOSARQuickLook');
const $canActivateAR = Symbol('canActivateAR');
const $arMode = Symbol('arMode');
const $arModes = Symbol('arModes');
const $arAnchor = Symbol('arAnchor');
const $preload = Symbol('preload');

const $onARButtonContainerClick = Symbol('onARButtonContainerClick');
const $onARStatus = Symbol('onARStatus');
const $onARTap = Symbol('onARTap');
const $selectARMode = Symbol('selectARMode');

export declare interface ARInterface {
  ar: boolean;
  arModes: string;
  arScale: string;
  iosSrc: string|null;
  readonly canActivateAR: boolean;
  activateAR(): Promise<void>;
}

export const ARMixin = <T extends Constructor<ModelViewerElementBase>>(
    ModelViewerElement: T): Constructor<ARInterface>&T => {
  class ARModelViewerElement extends ModelViewerElement {
    @property({type: Boolean, attribute: 'ar'}) ar: boolean = false;

    @property({type: String, attribute: 'ar-scale'}) arScale: string = 'auto';

    @property({type: String, attribute: 'ar-placement'})
    arPlacement: string = 'floor';

    @property({type: String, attribute: 'ar-modes'})
    arModes: string = DEFAULT_AR_MODES;

    @property({type: String, attribute: 'ios-src'}) iosSrc: string|null = null;

    @property({type: String, attribute: 'ar-custom-button-title'})
    arCustomButtonTitle: string = '';

    @property({type: String, attribute: 'ar-custom-button-link'})
    arCustomButtonLink?: URL;
    
    @property({type: String, attribute: 'ar-custom-button-ios-subtitle'})
    arCustomButtonIOSSubtitle: string = '';
    
    @property({type: String, attribute: 'ar-custom-button-ios-price'})
    arCustomButtonIOSPrice: string = '';

    @property({type: ApplePayButtonType, attribute: 'ar-custom-button-ios-apple-pay-type'})
    arCustomButtonIOSApplePayType = ApplePayButtonType.PAY;

    @property({type: String, attribute: 'ar-custom-button-ios-action'})
    arCustomButtonIOSAction?: string;

    @property({type: String, attribute: 'ar-custom-button-ios-custom'})
    arCustomButtonIOSCustom?: string;
    
    @property({type: AppleCustomBannerHeight, attribute: 'ar-custom-button-ios-custom-height'})
    arCustomButtonIOSCustomHeight?: AppleCustomBannerHeight;
    
    @property({type: String, attribute: 'ar-custom-button-android-fallback-url'})
    arCustomButtonAndroidFallbackURL?: string;
    
    @property({type: String, attribute: 'ar-custom-button-android-sound'})
    arCustomButtonAndroidSound?: string;

    get canActivateAR(): boolean {
      return this[$arMode] !== ARMode.NONE;
    }

    protected[$canActivateAR]: boolean = false;

    // TODO: Add this to the shadow root as part of this mixin's
    // implementation:
    protected[$arButtonContainer]: HTMLElement =
        this.shadowRoot!.querySelector('.ar-button') as HTMLElement;

    protected[$arAnchor] = document.createElement('a');

    protected[$arModes]: Set<ARMode> = new Set();
    protected[$arMode]: ARMode = ARMode.NONE;
    protected[$preload] = false;

    private[$onARButtonContainerClick] = (event: Event) => {
      event.preventDefault();
      this.activateAR();
    };

    private[$onARStatus] = ({status}: ThreeEvent) => {
      if (status === ARStatus.NOT_PRESENTING ||
          this[$renderer].arRenderer.presentedScene === this[$scene]) {
        this.setAttribute('ar-status', status);
        this.dispatchEvent(
            new CustomEvent<ARStatusDetails>('ar-status', {detail: {status}}));
      }
    };

    private[$onARTap] = (event: Event) => {
      if ((event as any).data == '_apple_ar_quicklook_button_tapped') {
        this.dispatchEvent(new CustomEvent('quick-look-button-tapped', {detail: {originalEvent: event}}));
      }
    };

    connectedCallback() {
      super.connectedCallback();

      this[$renderer].arRenderer.addEventListener('status', this[$onARStatus]);
      this.setAttribute('ar-status', ARStatus.NOT_PRESENTING);

      this[$arAnchor].addEventListener('message', this[$onARTap]);
    }

    disconnectedCallback() {
      super.disconnectedCallback();

      this[$renderer].arRenderer.removeEventListener(
          'status', this[$onARStatus]);

      this[$arAnchor].removeEventListener('message', this[$onARTap]);
    }

    async update(changedProperties: Map<string, any>) {
      super.update(changedProperties);

      if (changedProperties.has('arScale')) {
        this[$scene].canScale = this.arScale !== 'fixed';
      }

      if (changedProperties.has('arPlacement')) {
        this[$scene].setShadowIntensity(this[$scene].shadowIntensity);
        this[$needsRender]();
      }

      if (!changedProperties.has('ar') && !changedProperties.has('arModes') &&
          !changedProperties.has('iosSrc')) {
        return;
      }

      if (changedProperties.has('arModes')) {
        this[$arModes] = deserializeARModes(this.arModes);
      }

      this[$selectARMode]();
    }

    /**
     * Activates AR. Note that for any mode that is not WebXR-based, this
     * method most likely has to be called synchronous from a user
     * interaction handler. Otherwise, attempts to activate modes that
     * require user interaction will most likely be ignored.
     */
    async activateAR() {
      switch (this[$arMode]) {
        case ARMode.QUICK_LOOK:
          let iOSParameters = new IOSIntentParameters(this.arCustomButtonTitle,
            this.arCustomButtonIOSSubtitle,
            this.arCustomButtonIOSPrice,
            this.arScale === 'auto',
            this.arCustomButtonLink,
            this.arCustomButtonIOSApplePayType,
            this.arCustomButtonIOSAction,
            this.arCustomButtonIOSCustom, this.arCustomButtonIOSCustomHeight);
          let intent = new IOSIntent(new URL(this.iosSrc!), iOSParameters);
          this[$openIOSARQuickLook](intent);
          break;
        case ARMode.WEBXR:
          await this[$enterARWithWebXR]();
          break;
        case ARMode.SCENE_VIEWER:
          let androidParameters = new AndroidIntentParameters(this.arCustomButtonTitle,
            this.arCustomButtonAndroidFallbackURL,
            this.arScale === 'auto',
            this.arCustomButtonLink,
            this.arCustomButtonAndroidSound);
          let androidIntent = new AndroidIntent(new URL(this.src!), androidParameters);
          this[$openSceneViewer](androidIntent);
          break;
        default:
          console.warn(
              'No AR Mode can be activated. This is probably due to missing \
configuration or device capabilities');
          break;
      }
    }

    async[$selectARMode]() {
      this[$arMode] = ARMode.NONE;
      if (this.ar) {
        const arModes: ARMode[] = [];
        this[$arModes].forEach((value) => {
          arModes.push(value);
        });

        for (const value of arModes) {
          if (value === 'webxr' && IS_WEBXR_AR_CANDIDATE && !isWebXRBlocked &&
              await this[$renderer].arRenderer.supportsPresentation()) {
            this[$arMode] = ARMode.WEBXR;
            break;
          } else if (
              value === 'scene-viewer' && IS_SCENEVIEWER_CANDIDATE &&
              !isSceneViewerBlocked) {
            this[$arMode] = ARMode.SCENE_VIEWER;
            break;
          } else if (
              value === 'quick-look' && !!this.iosSrc &&
              IS_AR_QUICKLOOK_CANDIDATE) {
            this[$arMode] = ARMode.QUICK_LOOK;
            break;
          }
        }
      }

      if (this.canActivateAR) {
        this[$arButtonContainer].classList.add('enabled');
        this[$arButtonContainer].addEventListener(
            'click', this[$onARButtonContainerClick]);
      } else if (this[$arButtonContainer].classList.contains('enabled')) {
        this[$arButtonContainer].removeEventListener(
            'click', this[$onARButtonContainerClick]);
        this[$arButtonContainer].classList.remove('enabled');

        // If AR went from working to not, notify the element.
        const status = ARStatus.FAILED;
        this.setAttribute('ar-status', status);
        this.dispatchEvent(
            new CustomEvent<ARStatusDetails>('ar-status', {detail: {status}}));
      }
    }

    protected async[$enterARWithWebXR]() {
      console.log('Attempting to present in AR...');

      if (!this[$loaded]) {
        this[$preload] = true;
        this[$updateSource]();
        await waitForEvent(this, 'load');
        this[$preload] = false;
      }

      try {
        this[$arButtonContainer].removeEventListener(
            'click', this[$onARButtonContainerClick]);
        const {arRenderer} = this[$renderer];
        arRenderer.placeOnWall = this.arPlacement === 'wall';
        await arRenderer.present(this[$scene]);
      } catch (error) {
        console.warn('Error while trying to present to AR');
        console.error(error);
        await this[$renderer].arRenderer.stopPresenting();
        isWebXRBlocked = true;
        await this[$selectARMode]();
        this.activateAR();
      } finally {
        this[$selectARMode]();
      }
    }

    [$shouldAttemptPreload](): boolean {
      return super[$shouldAttemptPreload]() || this[$preload];
    }

    /**
     * Takes a URL and a title string, and attempts to launch Scene Viewer on
     * the current device.
     */
    [$openSceneViewer](androidIntent: AndroidIntent) {
      const location = self.location.toString();
      const locationUrl = new URL(location);

      locationUrl.hash = noArViewerSigil;

      // modelUrl can contain title/link/sound etc.
      /*
      params.set('mode', 'ar_only');
      if (!params.has('disable_occlusion')) {
        params.set('disable_occlusion', 'true');
      }
      if (this.arScale === 'fixed') {
        params.set('resizable', 'false');
      }
      if (this.arPlacement === 'wall') {
        params.set('enable_vertical_placement', 'true');
      }
      if (params.has('sound')) {
        const soundUrl = new URL(params.get('sound')!, location);
        params.set('sound', soundUrl.toString());
      }
      if (params.has('link')) {
        const linkUrl = new URL(params.get('link')!, location);
        params.set('link', linkUrl.toString());
      }
      */

      const undoHashChange = () => {
        if (self.location.hash === noArViewerSigil) {
          isSceneViewerBlocked = true;
          // The new history will be the current URL with a new hash.
          // Go back one step so that we reset to the expected URL.
          // NOTE(cdata): this should not invoke any browser-level navigation
          // because hash-only changes modify the URL in-place without
          // navigating:
          self.history.back();
          this[$selectARMode]();
          // Would be nice to activateAR() here, but webXR fails due to not
          // seeing a user activation.
        }
      };

      self.addEventListener('hashchange', undoHashChange, {once: true});

      const nativeIntent = androidIntent.toURL();

      this[$arAnchor].setAttribute('href', nativeIntent);
      this[$arAnchor].click();
    }

    /**
     * Takes a URL to a USDZ file and sets the appropriate fields so that Safari
     * iOS can intent to their AR Quick Look.
     */
    [$openIOSARQuickLook](iosIntent: IOSIntent) {
      const anchor = this[$arAnchor];
      anchor.setAttribute('rel', 'ar');
      const img = document.createElement('img');
      anchor.appendChild(img);
      anchor.setAttribute('href', iosIntent.toURL());
      anchor.click();
    }
  }

  return ARModelViewerElement;
};
