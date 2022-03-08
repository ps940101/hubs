import anime from "animejs";
import MovingAverage from "moving-average";
import { getThemeColor } from "../utils/theme";
import qsTruthy from "../utils/qs_truthy";
import { findAncestorWithComponent } from "../utils/scene-graph";
import { NAMETAG_VISIBILITY_DISTANCE_DEFAULT } from "../react-components/preferences-screen";
import { THREE } from "aframe";
import { setMatrixWorld } from "../utils/three-utils";

const DEBUG = qsTruthy("debug");
const NAMETAG_BACKGROUND_PADDING = 0.05;
const NAMETAG_STATUS_BORDER_PADDING = 0.035;
const NAMETAG_MIN_WIDTH = 0.6;
const NAMETAG_HEIGHT = 0.25;
const NAMETAG_OFFSET = 0.2;
const TYPING_ANIM_SPEED = 150;
const DISPLAY_NAME_LENGTH = 18;

const ANIM_CONFIG = {
  duration: 400,
  easing: "easeOutQuart",
  elasticity: 400,
  loop: 0,
  round: false
};

AFRAME.registerComponent("name-tag", {
  schema: {},
  init() {
    this.store = window.APP.store;
    this.displayName = null;
    this.identityName = null;
    this.isTalking = false;
    this.isTyping = false;
    this.isOwner = false;
    this.isRecording = false;
    this.isHandRaised = false;
    this.volumeAvg = new MovingAverage(128);
    this.isNametagVisible = true;
    this.size = new THREE.Vector3();
    this.avatarBBAA = new THREE.Box3();
    this.avatarBBAASize = new THREE.Vector3();
    this.avatarBBAACenter = new THREE.Vector3();
    this.nametagHeight = 0;
    this.tmpNametagVisible = false;

    this.onPresenceUpdated = this.onPresenceUpdated.bind(this);
    this.onModelLoading = this.onModelLoading.bind(this);
    this.onModelLoaded = this.onModelLoaded.bind(this);
    this.onAnalyserVolumeUpdated = this.onAnalyserVolumeUpdated.bind(this);
    this.onStateChanged = this.onStateChanged.bind(this);

    this.avatarRig = document.getElementById("avatar-rig");
    this.ikRootEl = findAncestorWithComponent(this.el, "ik-root");
    this.playerInfo = this.el.components["player-info"];

    this.nametagEl = this.el.querySelector(".nametag");
    this.identityNameEl = this.el.querySelector(".identityName");
    this.nametagBackgroundEl = this.el.querySelector(".nametag-background");
    this.nametagVolumeEl = this.el.querySelector(".nametag-volume");
    this.nametagStatusBorderEl = this.el.querySelector(".nametag-status-border");
    this.recordingBadgeEl = this.el.querySelector(".recordingBadge");
    this.modBadgeEl = this.el.querySelector(".modBadge");
    this.handRaisedEl = this.el.querySelector(".hand-raised-id");
    this.nametagTypingEl = this.el.querySelector(".nametag-typing");
    this.nametagTextEl = this.el.querySelector(".nametag-text");

    NAF.utils.getNetworkedEntity(this.el).then(networkedEntity => {
      this.playerSessionId = NAF.utils.getCreator(networkedEntity);
      const playerPresence = window.APP.hubChannel.presence.state[this.playerSessionId];
      if (playerPresence) {
        this.updateFromPresenceMeta(playerPresence.metas[0]);
      }
    });

    if (DEBUG) {
      this.avatarBBAAHelper = new THREE.Box3Helper(this.avatarBBAA, 0xffff00);
      this.el.sceneEl.object3D.add(this.avatarBBAAHelper);
    }

    this.nametagVisibility = this.store.state.preferences.nametagVisibility;
    this.nametagVisibilityDistance = this.nametagVisibilityDistance =
      this.store.state.preferences.nametagVisibilityDistance !== undefined
        ? this.store.state.preferences.nametagVisibilityDistance
        : NAMETAG_VISIBILITY_DISTANCE_DEFAULT;
    this.updateNameTagVisibility();
  },

  remove() {
    clearInterval(this.firstIkStepHandler);
    if (DEBUG) this.el.sceneEl.object3D.remove(this.avatarBBAAHelper);
  },

  tick: (() => {
    let typingAnimTime = 0;
    const worldPos = new THREE.Vector3();
    const avatarRigWorldPos = new THREE.Vector3();
    const matPos = new THREE.Vector3();
    const matRot = new THREE.Quaternion();
    const matScale = new THREE.Vector3();
    const mat = new THREE.Matrix4();
    return function(t) {
      if (this.model) {
        this.nametagEl.object3D.getWorldPosition(worldPos);
        this.neckEl.object3D.matrixWorld.decompose(matPos, matRot, matScale);
        matScale.set(1, 1, 1);
        matPos.setY(this.nametagElPosY + this.ikRootEl.object3D.position.y);
        mat.compose(
          matPos,
          matRot,
          matScale
        );
        setMatrixWorld(this.nametagEl.object3D, mat);
      }

      if (this.nametagVisibility === "showClose") {
        this.avatarRig.object3D.getWorldPosition(avatarRigWorldPos);
        this.el.object3D.getWorldPosition(worldPos);
        this.wasNametagVisible = this.isNametagVisible;
        this.isNametagVisible = avatarRigWorldPos.sub(worldPos).length() < this.nametagVisibilityDistance;
        this.updateNameTag();
      }
      if (!this.isTalking && this.isTyping) {
        typingAnimTime = t;
        this.nametagTypingEl.object3D.traverse(o => {
          if (o.material) {
            o.material.opacity = (Math.sin(typingAnimTime / TYPING_ANIM_SPEED) + 1) / 2;
            typingAnimTime -= TYPING_ANIM_SPEED;
          }
        });
      }
      if (DEBUG) {
        this.updateAvatarModelBBAA();
        this.avatarBBAAHelper.matrixNeedsUpdate = true;
        this.avatarBBAAHelper.updateMatrixWorld(true);
      }
    };
  })(),

  play() {
    this.el.addEventListener("model-loading", this.onModelLoading);
    this.el.addEventListener("model-loaded", this.onModelLoaded);
    this.el.addEventListener("analyser-volume-updated", this.onAnalyserVolumeUpdated);
    this.el.sceneEl.addEventListener("presence_updated", this.onPresenceUpdated);
    window.APP.store.addEventListener("statechanged", this.onStateChanged);
  },

  pause() {
    this.el.removeEventListener("model-loading", this.onModelLoading);
    this.el.removeEventListener("model-loaded", this.onModelLoaded);
    this.el.removeEventListener("analyser-volume-updated", this.onAnalyserVolumeUpdated);
    this.el.sceneEl.removeEventListener("presence_updated", this.onPresenceUpdated);
    window.APP.store.removeEventListener("statechanged", this.onStateChanged);
  },

  onPresenceUpdated({ detail: presenceMeta }) {
    if (presenceMeta.sessionId === this.playerSessionId) {
      this.updateFromPresenceMeta(presenceMeta);
    }
  },

  updateFromPresenceMeta(presenceMeta) {
    this.displayName = presenceMeta.profile.displayName;
    this.identityName = presenceMeta.profile.identityName;
    this.isRecording = !!(presenceMeta.streaming || presenceMeta.recording);
    this.isOwner = !!(presenceMeta.roles && presenceMeta.roles.owner);
    this.isTyping = !!presenceMeta.typing;
    this.isHandRaised = !!presenceMeta.hand_raised;
    this.updateNameTag();
  },

  updateDisplayName() {
    if (this.displayName) {
      this.nametagTextEl.addEventListener(
        "text-updated",
        () => {
          this.size = this.nametagTextEl.components["text"].getSize();
          this.size.x = Math.max(this.size.x, NAMETAG_MIN_WIDTH);
          this.updateNameTag();
        },
        { once: true }
      );
      if (this.displayName.length > DISPLAY_NAME_LENGTH) {
        this.displayName = this.displayName.slice(0, DISPLAY_NAME_LENGTH).concat("...");
      }
      this.nametagTextEl.setAttribute("text", {
        value: this.displayName
      });
    }

    if (this.identityName) {
      if (this.identityName.length > DISPLAY_NAME_LENGTH) {
        this.identityName = this.identityName.slice(0, DISPLAY_NAME_LENGTH).concat("...");
      }
      this.identityNameEl.setAttribute("text", { value: this.identityName });
      this.identityNameEl.object3D.visible = this.el.sceneEl.is("frozen");
    }
  },

  onModelLoading() {
    this.tmpNametagVisible = false;
    this.updateNameTagVisibility();
    this.model = null;
  },

  onModelLoaded({ detail: { model } }) {
    clearInterval(this.firstIkStepHandler);
    const checkIkStep = () => {
      if (this.ikRootEl.object3D.visible) {
        clearInterval(this.firstIkStepHandler);
        this.neckEl = this.el.querySelector(".Neck");
        this.tmpNametagVisible = true;
        this.updateNameTagVisibility();
        this.model = model;
        this.updateNameTagPosition();
      }
    };
    this.firstIkStepHandler = setInterval(checkIkStep, 500);
  },

  updateNameTagPosition() {
    this.updateAvatarModelBBAA();
    const tmpVector = new THREE.Vector3();
    this.nametagHeight =
      Math.abs(tmpVector.subVectors(this.ikRootEl.object3D.position, this.avatarBBAACenter).y) +
      this.avatarBBAASize.y / 2 +
      NAMETAG_OFFSET;
    this.nametagElPosY = this.nametagHeight;
    this.size = this.nametagTextEl.components["text"].getSize();
    this.size.x = Math.max(this.size.x, NAMETAG_MIN_WIDTH);
    this.updateNameTag();
  },

  onAnalyserVolumeUpdated({ detail: { volume } }) {
    let isTalking = false;
    this.volume = volume;
    this.volumeAvg.push(Date.now(), volume);
    if (!this.playerInfo.data.muted) {
      const average = this.volumeAvg.movingAverage();
      isTalking = average > 0.01;
    }
    this.wasTalking = this.isTalking;
    this.isTalking = isTalking;
    if (this.nametagVisibility === "showSpeaking") {
      if (!this.isTalking && this.wasTalking) {
        this.frozenTimer = setTimeout(() => {
          this.wasNametagVisible = this.isNametagVisible;
          this.isNametagVisible = false;
          this.isNametagVisible !== this.wasNametagVisible && this.updateNameTag();
        }, 1000);
      } else if (this.isTalking && !this.wasTalking) {
        clearTimeout(this.frozenTimer);
        this.wasNametagVisible = this.isNametagVisible;
        this.isNametagVisible = true;
        this.isNametagVisible !== this.wasNametagVisible && this.updateNameTag();
      }
    }
    this.isNametagVisible && this.isTalking !== this.wasTalking && this.updateBorder();
    this.isNametagVisible && this.updateVolume();
  },

  onStateChanged() {
    this.updateNameTagVisibility();
  },

  updateNameTagVisibility() {
    this.nametagVisibilityDistance =
      this.store.state.preferences.nametagVisibilityDistance !== undefined
        ? this.store.state.preferences.nametagVisibilityDistance
        : NAMETAG_VISIBILITY_DISTANCE_DEFAULT;
    this.wasNametagVisible = this.isNametagVisible;
    let prefNametagVisibility = this.store.state.preferences.nametagVisibility === undefined;
    if (this.nametagVisibility === "showNone") {
      prefNametagVisibility = false;
    } else if (this.nametagVisibility === "showAll") {
      prefNametagVisibility = true;
    } else if (this.nametagVisibility === "showFrozen") {
      prefNametagVisibility = this.el.sceneEl.is("frozen");
    } else if (this.nametagVisibility === "showSpeaking") {
      prefNametagVisibility = this.isTalking;
    } else {
      prefNametagVisibility = true;
    }
    this.isNametagVisible = prefNametagVisibility && this.tmpNametagVisible;
    this.updateNameTag();
  },

  updateNameTag() {
    if (!this.model) return;
    this.updateDisplayName();
    this.updateContainer();
    this.updateVolume();
    this.updateState();
  },

  updateContainer() {
    this.nametagBackgroundEl.setAttribute("visible", this.isNametagVisible);
    this.nametagBackgroundEl.setAttribute("slice9", {
      width: this.size.x + NAMETAG_BACKGROUND_PADDING * 2,
      height: NAMETAG_HEIGHT
    });
    this.updateBorder();
  },

  updateVolume() {
    this.nametagVolumeEl.setAttribute("visible", this.isTalking && this.isNametagVisible);
    this.nametagVolumeEl.setAttribute("scale", { x: this.volume * this.size.x });
    this.updateTyping();
  },

  updateBorder() {
    this.nametagStatusBorderEl.setAttribute("slice9", {
      width: this.size.x + NAMETAG_BACKGROUND_PADDING * 2 + NAMETAG_STATUS_BORDER_PADDING,
      height: NAMETAG_HEIGHT + NAMETAG_STATUS_BORDER_PADDING
    });
    this.nametagStatusBorderEl.setAttribute(
      "visible",
      (this.isTyping || this.isTalking || this.isHandRaised) && this.isNametagVisible
    );
    this.nametagStatusBorderEl.setAttribute(
      "text-button",
      `backgroundColor: ${getThemeColor(
        this.isHandRaised ? "nametag-border-color-raised-hand" : "nametag-border-color"
      )}`
    );
  },

  updateState() {
    this.recordingBadgeEl.setAttribute("visible", this.isRecording && this.isNametagVisible);
    this.modBadgeEl.setAttribute("visible", this.isOwner && !this.isRecording && this.isNametagVisible);
    this.handRaisedEl.setAttribute("visible", this.isHandRaised && this.isNametagVisible);
    const targetScale = this.isHandRaised ? 0.2 : 0;
    anime({
      ...ANIM_CONFIG,
      targets: {
        x: this.handRaisedEl.object3D.scale.x,
        y: this.handRaisedEl.object3D.scale.y,
        z: this.handRaisedEl.object3D.scale.z
      },
      x: targetScale,
      y: targetScale,
      z: targetScale,
      update: anim => {
        this.handRaisedEl.object3D.scale.set(
          anim.animatables[0].target.x,
          anim.animatables[0].target.y,
          anim.animatables[0].target.z
        );
        this.handRaisedEl.object3D.matrixNeedsUpdate = true;
      }
    });
    anime({
      ...ANIM_CONFIG,
      targets: {
        y: this.nametagElPosY
      },
      y: this.nametagHeight + (this.isHandRaised ? NAMETAG_OFFSET : 0),
      update: anim => {
        this.nametagElPosY = anim.animatables[0].target.y;
      }
    });
    this.updateTyping();
  },

  updateTyping() {
    for (const dotEl of this.nametagTypingEl.children) {
      dotEl.setAttribute("visible", this.isTyping && !this.isTalking && this.isNametagVisible);
    }
  },

  updateAvatarModelBBAA() {
    if (!this.model) return;
    this.avatarBBAA.setFromObject(this.model);
    this.avatarBBAA.getSize(this.avatarBBAASize);
    this.avatarBBAA.getCenter(this.avatarBBAACenter);
  }
});
