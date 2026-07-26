/**
 * Reward scenes — the two animated bits of gamification.
 * ------------------------------------------------------
 * Kept out of app.js on purpose: app.js is the teaching engine and should
 * stay readable without wading through SVG. This file has no idea what a
 * phoneme is — it just gets told "one right answer happened" and reacts.
 *
 * Two scenes:
 *   Scenes.penguin({ total, fed })  → Listen stage. Each correct answer
 *                                     throws a fish; the penguin eats it.
 *   Scenes.hammer({ total, charge }) → Spell stage. Each correct answer
 *                                      winds the hammer up a notch; the
 *                                      last question drops it on the
 *                                      avocado. Splatter scales with the
 *                                      number of correct answers.
 *
 * Both return an object with a `.node` (drop it in the card) plus methods.
 * Both rebuild cleanly on every re-render — app.js wipes the DOM between
 * questions, so the scene is constructed from the running totals held in
 * state.game, never from anything stored in here.
 *
 * Reduced motion: every animation below has a still equivalent. Nothing
 * is communicated by movement alone — the counter row and the status line
 * carry the same information in text.
 */

(function () {
  "use strict";

  const REDUCED =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function make(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  // Restart a CSS animation on an element that may already have run it.
  function replay(node, className) {
    node.classList.remove(className);
    void node.offsetWidth; // force reflow so the animation restarts
    node.classList.add(className);
  }

  // A row of little pips under each scene — the honest read-out of how
  // many words have actually been mastered, which the artwork only hints at.
  function meterRow(total, filled, glyph) {
    const row = document.createElement("div");
    row.className = "scene-meter";
    for (let i = 0; i < total; i++) {
      const pip = document.createElement("span");
      pip.className = "pip" + (i < filled ? " pip-full" : "");
      pip.innerHTML = glyph;
      row.appendChild(pip);
    }
    return row;
  }

  const FISH_PIP =
    '<svg viewBox="0 0 26 14" aria-hidden="true"><path d="M2,7 C6,1 14,1 18,7 C14,13 6,13 2,7 Z M18,7 L24,2 L24,12 Z"/></svg>';

  const CHARGE_PIP =
    '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7,2 L12,9 L8.5,9 L8.5,12 L5.5,12 L5.5,9 L2,9 Z"/></svg>';

  // ==========================================================================
  // Scene 1 — Feed the penguin (Listen stage)
  // ==========================================================================

  const PENGUIN_ART = `
<svg class="scene-art" viewBox="0 0 300 176" aria-hidden="true" focusable="false">
  <defs>
    <clipPath id="peng-clip"><rect x="0" y="0" width="300" height="176" rx="10"/></clipPath>
  </defs>
  <g clip-path="url(#peng-clip)">
    <rect class="peng-sky" x="0" y="0" width="300" height="176" rx="10"/>

    <path class="ice-far" d="M18,150 L52,112 L86,150 Z"/>
    <path class="ice-far" d="M212,150 L246,120 L282,150 Z"/>

    <path class="ice" d="M0,148 C42,138 74,143 112,140 C154,136 202,142 242,139 C270,137 288,141 300,145 L300,176 L0,176 Z"/>
    <path class="ice-shade" d="M0,158 C60,152 120,156 180,153 C230,151 270,155 300,153 L300,176 L0,176 Z"/>

    <g class="peng">
      <path class="peng-body" d="M141,50 C111,50 94,79 94,110 C94,139 114,153 141,153 C168,153 188,139 188,110 C188,79 171,50 141,50 Z"/>

      <ellipse class="peng-foot" cx="126" cy="153" rx="14" ry="6"/>
      <ellipse class="peng-foot" cx="158" cy="153" rx="14" ry="6"/>

      <g class="peng-belly-wrap">
        <ellipse class="peng-belly" cx="143" cy="118" rx="31" ry="33"/>
      </g>

      <path class="peng-wing peng-wing-l" d="M99,84 C87,95 85,124 95,143 C99,147 106,144 104,138 C96,120 98,101 105,88 Z"/>
      <path class="peng-wing peng-wing-r" d="M185,84 C197,95 199,124 189,143 C185,147 178,144 180,138 C188,120 186,101 179,88 Z"/>

      <g class="peng-face">
        <circle class="peng-eye-white" cx="127" cy="86" r="9"/>
        <circle class="peng-eye-white" cx="154" cy="84" r="10"/>
        <g class="peng-pupils">
          <circle class="peng-pupil" cx="129" cy="87" r="4.4"/>
          <circle class="peng-pupil" cx="156" cy="85" r="4.8"/>
        </g>
        <g class="peng-brows">
          <path class="peng-brow" d="M120,74 L135,78"/>
          <path class="peng-brow" d="M164,71 L148,76"/>
        </g>
      </g>

      <g transform="translate(141,100)">
        <path class="peng-beak beak-upper" d="M-4,-4 L30,2 L-4,4 Z"/>
        <g class="beak-lower">
          <path class="peng-beak" d="M-4,4 L30,2 L-4,13 Z"/>
        </g>
      </g>

      <g class="peng-note" transform="translate(196,72)">
        <text x="0" y="0" class="note-glyph">&#9834;</text>
      </g>
    </g>

    <g class="fish-flyer">
      <g class="fish-arc">
        <g class="fish-spin">
          <path class="fish-body" d="M-14,0 C-8,-9 6,-9 12,0 C6,9 -8,9 -14,0 Z"/>
          <path class="fish-tail" d="M12,0 L22,-7 L22,7 Z"/>
          <circle class="fish-eye" cx="-7" cy="-2" r="1.8"/>
        </g>
      </g>
    </g>
  </g>
</svg>`;

  function penguinScene(opts) {
    const total = opts.total;
    let fed = opts.fed || 0;

    const node = document.createElement("div");
    node.className = "scene scene-penguin";
    node.appendChild(make(PENGUIN_ART));

    const meter = meterRow(total, fed, FISH_PIP);
    node.appendChild(meter);

    const status = document.createElement("p");
    status.className = "scene-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    node.appendChild(status);

    const art = node.querySelector(".scene-art");
    const peng = node.querySelector(".peng");
    const belly = node.querySelector(".peng-belly-wrap");

    function setBelly() {
      // Grows to about a third bigger over the whole stage — enough to
      // notice at the end, not enough to distract question to question.
      const grown = 1 + 0.3 * (total ? Math.min(fed, total) / total : 0);
      belly.style.transform = `translate(143px,118px) scale(${grown.toFixed(3)}) translate(-143px,-118px)`;
    }

    function setStatus() {
      const left = total - fed;
      status.textContent =
        fed >= total
          ? `Fish caught: ${fed} of ${total} — that penguin is stuffed.`
          : `Fish caught: ${fed} of ${total} — ${left} word${left === 1 ? "" : "s"} still to get right.`;
    }

    setBelly();
    setStatus();
    if (fed >= total && total > 0) art.classList.add("is-stuffed");

    return {
      node: node,

      /** Correct answer: throw a fish, penguin eats it, belly grows. */
      feed: function () {
        fed++;
        setBelly();
        setStatus();
        const pips = meter.querySelectorAll(".pip");
        const pip = pips[Math.min(fed, total) - 1];
        if (pip) {
          pip.classList.add("pip-full");
          if (!REDUCED) replay(pip, "pip-pop");
        }
        if (fed >= total) art.classList.add("is-stuffed");
        if (REDUCED) {
          art.classList.add("is-happy");
          return;
        }
        replay(art, "is-feeding");
        window.setTimeout(() => {
          art.classList.add("is-happy");
          replay(peng, "is-hopping");
        }, 560);
        window.setTimeout(() => art.classList.remove("is-happy"), 2200);
      },

      /** Wrong answer: the fish falls short. Brief, and never scolding —
       *  the written explanation next to it is the part that matters. */
      miss: function () {
        if (REDUCED) return;
        replay(art, "is-missing");
        window.setTimeout(() => art.classList.remove("is-missing"), 1400);
      }
    };
  }

  // ==========================================================================
  // Scene 2 — Hammer and avocado (Spell stage)
  // ==========================================================================

  // Geometry note for anyone editing the artwork: the hammer pivots at
  // (245,148). At rotate(0) the head sits exactly on top of the avocado —
  // that is the impact frame. Bigger angles wind it back up and to the
  // right. Move the avocado and you must re-check that resting angle.
  const HAMMER_ART = `
<svg class="scene-art" viewBox="0 0 300 190" aria-hidden="true" focusable="false">
  <defs>
    <clipPath id="hammer-clip"><rect x="0" y="0" width="300" height="190" rx="10"/></clipPath>
  </defs>
  <g clip-path="url(#hammer-clip)">
    <rect class="bench-back" x="0" y="0" width="300" height="190" rx="10"/>

    <rect class="bench" x="0" y="156" width="300" height="34"/>
    <path class="bench-edge" d="M0,156 L300,156"/>
    <path class="bench-grain" d="M0,168 L300,165 M0,180 L300,182"/>

    <g class="shake">
      <g class="avo-pulp"><ellipse cx="150" cy="154" rx="32" ry="9"/></g>

      <g class="avo-wrap">
        <g class="avo">
          <path class="avo-skin" d="M150,92 C141,92 136,102 136,111 C136,119 127,123 125,134 C121,149 134,159 150,159 C166,159 179,149 175,134 C173,123 164,119 164,111 C164,102 159,92 150,92 Z"/>
          <path class="avo-shine" d="M142,104 C136,112 133,122 134,132"/>
        </g>
      </g>

      <g class="avo-stone"><circle cx="150" cy="136" r="12"/></g>

      <g class="splat-field" transform="translate(150,100)"></g>

      <g transform="translate(232,150)">
        <g class="hammer-arm">
          <line class="hammer-handle" x1="5" y1="5" x2="-71" y2="-70"/>
          <line class="hammer-grip" x1="7" y1="7" x2="-20" y2="-19"/>
          <g transform="translate(-82,-50) rotate(24)">
            <rect class="hammer-head" x="-14" y="-50" width="28" height="50" rx="6"/>
            <rect class="hammer-band" x="-14" y="-32" width="28" height="12"/>
            <rect class="hammer-face" x="-14" y="-11" width="28" height="11" rx="4"/>
          </g>
        </g>
      </g>
    </g>

    <g class="impact-flash"><circle cx="150" cy="102" r="64"/></g>
  </g>
</svg>`;

  const REST_DEG = 22; // hovering just clear of the avocado
  const WOUND_DEG = 60; // fully wound back

  function hammerScene(opts) {
    const total = opts.total;
    let charge = opts.charge || 0;
    const smashed = !!opts.smashed;

    const node = document.createElement("div");
    node.className = "scene scene-hammer";
    node.appendChild(make(HAMMER_ART));

    const meter = meterRow(total, charge, CHARGE_PIP);
    node.appendChild(meter);

    const status = document.createElement("p");
    status.className = "scene-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    node.appendChild(status);

    const art = node.querySelector(".scene-art");
    const arm = node.querySelector(".hammer-arm");
    const field = node.querySelector(".splat-field");

    function angleFor(c) {
      return REST_DEG + (WOUND_DEG - REST_DEG) * (total ? Math.min(c, total) / total : 0);
    }

    function setArm(c) {
      arm.style.transform = `rotate(${angleFor(c).toFixed(2)}deg)`;
    }

    function setStatus() {
      const left = total - charge;
      status.textContent =
        left > 0
          ? `Hammer wound back: ${charge} of ${total}. ${left} more to get right before it drops.`
          : `Hammer fully wound back: ${charge} of ${total}.`;
    }

    setArm(charge);
    setStatus();

    // Splatter is drawn from the same routine whether it is animating in
    // or being restored on the summary card, so the aftermath always
    // matches what the student just watched.
    function paintSplatter(ratio, still) {
      if (ratio <= 0) return; // nothing was swung; nothing splatters
      const blobs = 4 + Math.round(ratio * 26);
      for (let i = 0; i < blobs; i++) {
        const angle = rand(-Math.PI * 0.95, -Math.PI * 0.05);
        const spread = (26 + ratio * 96) * rand(0.45, 1);
        const dx = Math.cos(angle) * spread * rand(0.9, 1.6);
        const dy = Math.sin(angle) * spread * rand(0.55, 1);
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", "splat" + (i % 5 === 0 ? " splat-dark" : ""));
        g.style.setProperty("--dx", dx.toFixed(1) + "px");
        g.style.setProperty("--dy", dy.toFixed(1) + "px");
        g.style.setProperty("--s", rand(0.35, 0.35 + ratio * 1.15).toFixed(2));
        g.style.setProperty("--r", rand(-180, 180).toFixed(0) + "deg");
        g.style.setProperty("--d", (still ? 0 : rand(0, 130)).toFixed(0) + "ms");
        g.innerHTML =
          '<path d="M0,-9 C6,-10 12,-5 11,1 C10,7 3,10 -2,9 C-8,8 -11,3 -10,-3 C-9,-7 -5,-8 0,-9 Z"/>';
        field.appendChild(g);
      }
      // A few land on the lens.
      const lensCount = Math.round(ratio * 5);
      for (let i = 0; i < lensCount; i++) {
        const lens = document.createElement("span");
        lens.className = "lens-splat";
        lens.style.left = rand(8, 84).toFixed(1) + "%";
        lens.style.top = rand(6, 70).toFixed(1) + "%";
        lens.style.setProperty("--s", rand(0.7, 1.5 + ratio).toFixed(2));
        lens.style.setProperty("--r", rand(0, 360).toFixed(0) + "deg");
        lens.style.setProperty("--d", (still ? 0 : rand(40, 220)).toFixed(0) + "ms");
        lens.innerHTML =
          '<svg viewBox="-14 -14 28 28" aria-hidden="true"><path d="M0,-11 C7,-12 13,-6 12,1 C11,8 4,12 -2,11 C-9,10 -13,4 -12,-3 C-11,-8 -6,-10 0,-11 Z"/></svg>';
        node.appendChild(lens);
      }
      field.classList.add(still ? "is-still" : "is-flying");
    }

    if (smashed) {
      // Rebuilt after the fact (summary card): show the aftermath, no replay.
      // A zero-score run never landed a blow, so the avocado is still whole
      // here — the summary has to match what they actually watched.
      const ratio = opts.ratio || 0;
      if (ratio > 0) {
        art.classList.add("is-wrecked");
        arm.style.transform = "rotate(6deg)";
        paintSplatter(ratio, true);
      } else {
        arm.style.transform = "rotate(14deg)";
      }
      status.textContent = verdictFor(ratio).status;
    }

    return {
      node: node,

      /** Correct answer: wind the hammer back one notch. */
      chargeUp: function () {
        charge++;
        setArm(charge);
        setStatus();
        const pips = meter.querySelectorAll(".pip");
        const pip = pips[Math.min(charge, total) - 1];
        if (pip) {
          pip.classList.add("pip-full");
          if (!REDUCED) replay(pip, "pip-pop");
        }
        if (!REDUCED) replay(art, "is-charging");
      },

      /**
       * Last question of the stage: let it fall. `ratio` is correct
       * answers ÷ words, and drives how far the guacamole travels.
       * Resolves once the mess has settled so app.js can reveal the
       * verdict line underneath.
       */
      smash: function (ratio) {
        return new Promise((resolve) => {
          const verdict = verdictFor(ratio);
          status.textContent = verdict.status;

          if (ratio <= 0) {
            // Nothing to swing with. The avocado gets a tap and survives.
            art.classList.add("is-tapping");
            window.setTimeout(resolve, REDUCED ? 0 : 700);
            return;
          }

          if (REDUCED) {
            art.classList.add("is-wrecked");
            arm.style.transform = "rotate(6deg)";
            paintSplatter(ratio, true);
            resolve();
            return;
          }

          art.style.setProperty("--shake", (2 + ratio * 6).toFixed(1) + "px");
          art.classList.add("is-smashing");
          arm.style.transform = "rotate(-4deg)";

          window.setTimeout(() => {
            art.classList.add("is-wrecked");
            paintSplatter(ratio, false);
            arm.style.transform = "rotate(6deg)";
          }, 240);

          window.setTimeout(resolve, 1250);
        });
      }
    };
  }

  /**
   * Wording for the pay-off. Deliberately not scored out of ten and not
   * scolding at the bottom end — a student who got none right is being
   * pointed at another go, not told off.
   */
  function verdictFor(ratio) {
    if (ratio >= 0.999)
      return { headline: "GUACAMOLE.", status: "Every word right — total avocado devastation." };
    if (ratio >= 0.8) return { headline: "Properly flattened.", status: "A serious splat." };
    if (ratio >= 0.5) return { headline: "Squashed.", status: "A decent splat." };
    if (ratio >= 0.25) return { headline: "A bit of a dent.", status: "The avocado is bruised, not beaten." };
    if (ratio > 0) return { headline: "Barely a mark.", status: "That avocado got off lightly." };
    return {
      headline: "The avocado survives.",
      status: "No correct answers meant nothing to swing with — go again and flatten it."
    };
  }

  window.Scenes = {
    penguin: penguinScene,
    hammer: hammerScene,
    verdictFor: verdictFor,
    reducedMotion: REDUCED
  };
})();
