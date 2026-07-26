/**
 * Contrastive Phonics — core exercise engine (Phase 1)
 *
 * This file knows nothing German-specific — it reads whatever is in
 * LEVELS (data.js) and drives the five-stage loop. Adding levels 2-14
 * later is a data.js change only.
 *
 * Extension point for later phases: INTERLEAVED REVIEW.
 * Once LEVELS.length > 1, insert a review stage that samples words from
 * previously-completed levels before the "spelling" stage of a new
 * level. See buildStageList() below for exactly where that slots in.
 */

// ---- Tunable constants -----------------------------------------------
// How many words per pattern the Listen (discrimination) stage drills.
// 3+3 = 6 questions, sampled from the full patternA/patternB word lists.
const DISCRIMINATION_WORDS_PER_PATTERN = 3;

// Fallback only: used for the Production stage if a level doesn't define
// an explicit production.words list in data.js. Levels here always
// specify their own words, so this is just a safety net for future ones.
const PRODUCTION_WORDS_PER_PATTERN = 3;

// How many times a student can get a single word wrong before the app
// lets them move on without mastering it (still logged for the summary).
const MAX_ATTEMPTS_PER_WORD = 3;

// ---- Small utilities -----------------------------------------------------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

// ---- Text-to-speech --------------------------------------------------------

const TTS = {
  voice: null,
  ready: false,
  supported: "speechSynthesis" in window,
  loadVoices() {
    if (!this.supported) return;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    this.voice =
      voices.find((v) => v.lang && v.lang.toLowerCase() === "de-de") ||
      voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("de")) ||
      null;
    this.ready = true;
    document.dispatchEvent(new CustomEvent("tts-ready"));
  },
  speak(text, rate) {
    if (!this.supported) return false;
    speechSynthesis.cancel(); // avoid queueing pile-ups on rapid taps
    const utter = new SpeechSynthesisUtterance(text);
    if (this.voice) {
      utter.voice = this.voice;
      utter.lang = this.voice.lang;
    } else {
      utter.lang = "de-DE"; // best-effort even with no German voice installed
    }
    utter.rate = rate || 0.95;
    speechSynthesis.speak(utter);
    return true;
  }
};

if (TTS.supported) {
  TTS.loadVoices();
  speechSynthesis.addEventListener("voiceschanged", () => TTS.loadVoices());
}

function playAudioButton(text, label = "▶ Play", rate) {
  const btn = el("button", { class: "btn btn-audio" }, label);
  btn.addEventListener("click", () => {
    if (!TTS.supported) {
      flashUnsupported(btn);
      return;
    }
    if (!TTS.voice) warnNoGermanVoice();
    TTS.speak(text, rate);
  });
  return btn;
}

let voiceWarningShown = false;
function warnNoGermanVoice() {
  if (voiceWarningShown) return;
  voiceWarningShown = true;
  const banner = document.getElementById("global-banner");
  banner.textContent =
    "No German voice was found on this device, so audio may sound off or use a default voice. The exercise still works — check System/Browser settings for a German (de-DE) voice if this matters.";
  banner.hidden = false;
}

function flashUnsupported(btn) {
  btn.textContent = "Audio not supported here";
  btn.disabled = true;
}

// ---- Recording -------------------------------------------------------------
// Fixed design: start() only starts the recorder and returns immediately.
// stopAndGetUrl() is a separate call, triggered by the Stop button, that
// resolves once the 'stop' event has actually fired. Earlier versions
// awaited the stop event from inside start() itself, which meant the Stop
// button's click handler wasn't attached until after start() had already
// finished — a deadlock, since nothing could ever fire 'stop'.

const Recorder = {
  supported: !!(navigator.mediaDevices && window.MediaRecorder),
  stream: null,
  recorder: null,
  chunks: [],
  currentUrl: null,

  async ensureStream() {
    if (this.stream) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return this.stream;
  },

  async start() {
    const stream = await this.ensureStream();
    this.chunks = [];
    this.recorder = new MediaRecorder(stream);
    this.recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    });
    this.recorder.start();
  },

  stopAndGetUrl() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") {
        resolve(null);
        return;
      }
      this.recorder.addEventListener(
        "stop",
        () => {
          const blob = new Blob(this.chunks, { type: "audio/webm" });
          this.discardUrl();
          this.currentUrl = URL.createObjectURL(blob);
          resolve(this.currentUrl);
        },
        { once: true }
      );
      this.recorder.stop();
    });
  },

  discardUrl() {
    // Nothing is persisted beyond the current word, per the no-storage
    // requirement — every previous recording is explicitly freed.
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  },

  releaseMic() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }
};

// ---- Gamification (lightweight, in-session only — nothing persisted) -----

const AFFIRMATIONS = ["Correct!", "Nice one!", "Got it!", "Well done!", "Spot on!", "Exactly right!"];
function pickAffirmation() {
  return AFFIRMATIONS[Math.floor(Math.random() * AFFIRMATIONS.length)];
}

function renderScoreboard() {
  const bar = document.getElementById("scoreboard");
  if (!bar) return;
  bar.textContent =
    `★ ${state.score} pts` + (state.streak >= 2 ? `   🔥 ${state.streak} in a row` : "");
}

function awardPoints(n) {
  state.score += n;
  renderScoreboard();
}

function registerCorrectStreak() {
  state.streak++;
  if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  renderScoreboard();
}

function registerWrongStreak() {
  state.streak = 0;
  renderScoreboard();
}

function starsFor(ratio) {
  if (ratio >= 0.9) return 3;
  if (ratio >= 0.7) return 2;
  if (ratio >= 0.4) return 1;
  return 0;
}

// ---- Drill queue (discrimination + encode share this) ---------------------
// A "drill" runs the word list once, then automatically loops any wrong
// answers back in as a second (or third) round, so mistakes get repeated
// before the stage ends. A word that's wrong MAX_ATTEMPTS_PER_WORD times
// is let through without being mastered, so nobody gets stuck.

function newDrillState(items) {
  return {
    round: shuffle(items),
    idx: 0,
    attempts: {},
    firstPassCorrect: 0,
    totalWords: items.length,
    movedOn: [],
    nextRound: [],
    roundNumber: 1
  };
}

function drillKey(item) {
  return item.pattern + ":" + item.word;
}

function currentDrillItem(drill) {
  return drill.round[drill.idx];
}

function isDrillDone(drill) {
  return drill.idx >= drill.round.length && drill.nextRound.length === 0;
}

// Records the answer's outcome and returns the attempt number (1-based)
// for THIS word. Called once, immediately when the student answers.
function recordDrillAnswer(drill, item, wasCorrect) {
  const key = drillKey(item);
  const attemptNumber = (drill.attempts[key] || 0) + 1;
  drill.attempts[key] = attemptNumber;

  if (wasCorrect) {
    if (attemptNumber === 1) drill.firstPassCorrect++;
  } else if (attemptNumber >= MAX_ATTEMPTS_PER_WORD) {
    drill.movedOn.push(item);
  } else {
    drill.nextRound.push(item);
  }
  return attemptNumber;
}

// Moves to the next word, rolling missed words into a new round once the
// current one is exhausted. Called when the student taps "Next word".
function advanceDrillIndex(drill) {
  drill.idx++;
  if (drill.idx >= drill.round.length && drill.nextRound.length > 0) {
    drill.round = shuffle(drill.nextRound);
    drill.nextRound = [];
    drill.idx = 0;
    drill.roundNumber++;
  }
}

function drillSummaryCard(drill, label, onContinue, continueLabel, sceneNode) {
  const stars = starsFor(drill.totalWords ? drill.firstPassCorrect / drill.totalWords : 0);
  const card = el("div", { class: "card" }, [
    sceneNode,
    el("h2", {}, `${label} — done`),
    el("div", { class: "stars" }, "★".repeat(stars) + "☆".repeat(3 - stars)),
    el("p", {}, `${drill.firstPassCorrect} / ${drill.totalWords} correct on the first try.`)
  ]);
  if (drill.movedOn.length) {
    card.appendChild(
      el(
        "p",
        { class: "muted" },
        "Needs more practice next time: " + drill.movedOn.map((w) => w.word).join(", ")
      )
    );
  }
  card.appendChild(el("button", { class: "btn btn-primary", onclick: onContinue }, continueLabel));
  return card;
}

// Builds the kid-friendly explanation shown after a wrong answer, e.g.
// "When i and e go walking, the last one does the talking. The correct
// word was Arbeit. This word has the eye sound, so it needs the spelling ei."
function explainWrong(level, item, correctPattern) {
  return `${level.mnemonic} The correct word was "${item.word}". This word has the ${correctPattern.soundHint} sound, so it needs the spelling "${correctPattern.grapheme}".`;
}

// ---- Engine state ----------------------------------------------------

const state = {
  level: LEVELS[0],
  stageIndex: 0,
  stages: [],
  discrimination: { drill: null },
  production: { queue: [], i: 0 },
  spelling: { drill: null },
  score: 0,
  streak: 0,
  bestStreak: 0,
  // Reward-scene counters. Held here rather than inside the scenes
  // themselves because app.js wipes the DOM between questions — the
  // scene is rebuilt from these numbers every render.
  game: { fish: 0, hammer: 0, smashed: false, ratio: 0 }
};

const dictationPlayed = new Set();

function buildStageList() {
  // Extension point: once LEVELS.length > 1, splice an "interleaved
  // review" stage in here, between "production" and "spelling", sampling
  // words from levels[0..levelIndex-1]. Left as a single linear list for
  // Phase 1 since there is nothing yet to interleave.
  return ["intro", "discrimination", "production", "spelling", "final"];
}

// Balanced sample: perPattern words from each of patternA/patternB, so a
// shortened drill still contrasts both patterns evenly rather than
// skewing toward whichever one the random sample favours.
function sampleWordList(level, perPattern) {
  const wordsA = sample(level.patternA.words, perPattern).map((w) => ({ word: w, pattern: "A" }));
  const wordsB = sample(level.patternB.words, perPattern).map((w) => ({ word: w, pattern: "B" }));
  return [...wordsA, ...wordsB];
}

// Production reads its word list straight from data.js (level.production.words)
// so a teacher can pin the exact words students record. Falls back to a
// balanced sample if a level doesn't define one.
function productionWordList(level) {
  if (level.production && level.production.words && level.production.words.length) {
    return level.production.words;
  }
  const wordsA = sample(level.patternA.words, PRODUCTION_WORDS_PER_PATTERN);
  const wordsB = sample(level.patternB.words, PRODUCTION_WORDS_PER_PATTERN);
  return [...wordsA, ...wordsB];
}

// Same idea for the Spelling stage: an explicit level.spelling.words list,
// tagged with its A/B pattern (needed for the wrong-answer explanation),
// falling back to the full word bank if a level doesn't define one.
function spellingDrillItems(level) {
  const words =
    level.spelling && level.spelling.words && level.spelling.words.length
      ? level.spelling.words
      : [...level.patternA.words, ...level.patternB.words];
  return words.map((w) => ({
    word: w,
    pattern: level.patternA.words.includes(w) ? "A" : "B"
  }));
}

function patternOf(level, key) {
  return key === "A" ? level.patternA : level.patternB;
}

function init() {
  state.stages = buildStageList();
  state.stageIndex = 0;
  renderScoreboard();
  renderStageDots();
  renderCurrentStage();
}

// ---- Rendering shell ---------------------------------------------------

const root = document.getElementById("exercise-root");

function renderStageDots() {
  const wrap = document.getElementById("stage-dots");
  wrap.innerHTML = "";
  const labels = {
    intro: "Rule",
    discrimination: "Listen",
    production: "Speak",
    spelling: "Spell",
    final: "Dictation"
  };
  state.stages.forEach((s, i) => {
    const dot = el(
      "div",
      { class: "stage-dot" + (i === state.stageIndex ? " active" : i < state.stageIndex ? " done" : "") },
      labels[s]
    );
    wrap.appendChild(dot);
  });
}

function goToStage(i) {
  state.stageIndex = i;
  renderStageDots();
  renderCurrentStage();
  root.scrollIntoView({ behavior: "smooth", block: "start" });
}

function nextStage() {
  goToStage(Math.min(state.stageIndex + 1, state.stages.length - 1));
}

function renderCurrentStage() {
  root.innerHTML = "";
  const stage = state.stages[state.stageIndex];
  if (stage === "intro") renderIntro();
  else if (stage === "discrimination") renderDiscrimination();
  else if (stage === "production") renderProduction();
  else if (stage === "spelling") renderSpelling();
  else if (stage === "final") renderFinal();
}

// ---- Stage 1: Rule introduction ----------------------------------------

function renderIntro() {
  const level = state.level;
  const card = el("div", { class: "card intro-card" }, [
    el("h2", {}, level.title),
    el("p", { class: "mnemonic" }, `"${level.mnemonic}"`),
    el("div", { class: "pattern-pair" }, [
      renderPatternExample(level.patternA),
      el("div", { class: "vs" }, "vs"),
      renderPatternExample(level.patternB)
    ]),
    el("button", { class: "btn btn-primary", onclick: nextStage }, "I've got it — start listening →")
  ]);
  root.appendChild(card);
}

function renderPatternExample(pattern) {
  return el("div", { class: "pattern-example" }, [
    el("div", { class: "grapheme" }, `"${pattern.grapheme}"`),
    el("div", { class: "sound-label" }, pattern.label),
    el("div", { class: "example-word" }, pattern.exampleWord),
    playAudioButton(pattern.exampleWord, "▶ Hear " + pattern.exampleWord)
  ]);
}

// ---- Stage 2: Discrimination --------------------------------------------

function renderDiscrimination() {
  const level = state.level;
  if (!state.discrimination.drill) {
    state.discrimination.drill = newDrillState(sampleWordList(level, DISCRIMINATION_WORDS_PER_PATTERN));
  }
  const drill = state.discrimination.drill;

  if (isDrillDone(drill)) {
    const wellFed = Scenes.penguin({ total: drill.totalWords, fed: state.game.fish });
    root.appendChild(
      drillSummaryCard(drill, "Listening", nextStage, "Continue to speaking →", wellFed.node)
    );
    return;
  }

  const item = currentDrillItem(drill);
  const pattern = patternOf(level, item.pattern);
  const otherPattern = item.pattern === "A" ? level.patternB : level.patternA;
  const buttons = shuffle([pattern, otherPattern]); // randomise button position each attempt
  const attemptNumber = (drill.attempts[drillKey(item)] || 0) + 1;

  const card = el("div", { class: "card" });
  // The penguin goes above the question so the throw happens in view while
  // they are still looking at the answer they just gave.
  const scene = Scenes.penguin({ total: drill.totalWords, fed: state.game.fish });
  card.appendChild(scene.node);
  if (drill.idx === 0 && drill.roundNumber > 1) {
    card.appendChild(el("div", { class: "round-banner" }, "Let's try the ones you missed again."));
  }
  card.appendChild(
    el(
      "div",
      { class: "progress-line" },
      `Word ${drill.idx + 1} of ${drill.round.length}` +
        (attemptNumber > 1 ? ` — attempt ${attemptNumber} of ${MAX_ATTEMPTS_PER_WORD}` : "")
    )
  );
  card.appendChild(el("h2", {}, "Which spelling did you hear?"));
  card.appendChild(playAudioButton(item.word, "▶ Play word"));

  const btnRow = el("div", { class: "choice-row" });
  buttons.forEach((p) => {
    const choice = el("button", { class: "btn btn-choice" }, `"${p.grapheme}" — ${p.soundHint} sound`);
    choice.addEventListener("click", () =>
      handleDiscriminationAnswer(choice, btnRow, p, pattern, item, drill, scene)
    );
    btnRow.appendChild(choice);
  });
  card.appendChild(btnRow);
  card.appendChild(el("div", { class: "feedback", id: "disc-feedback" }));

  root.appendChild(card);
}

function handleDiscriminationAnswer(choiceBtn, btnRow, chosenPattern, correctPattern, item, drill, scene) {
  const feedback = document.getElementById("disc-feedback");
  [...btnRow.children].forEach((b) => (b.disabled = true));
  const correct = chosenPattern.grapheme === correctPattern.grapheme;
  const attemptNumber = recordDrillAnswer(drill, item, correct);

  feedback.innerHTML = "";
  if (correct) {
    choiceBtn.classList.add("correct");
    registerCorrectStreak();
    awardPoints(attemptNumber === 1 ? 10 : 5);
    // Count first, animate second — they can hit "Next word" mid-throw and
    // the fish must still be on the board when the scene rebuilds.
    state.game.fish++;
    scene.feed();
    feedback.appendChild(el("p", { class: "feedback-text good" }, pickAffirmation()));
  } else {
    choiceBtn.classList.add("wrong");
    registerWrongStreak();
    scene.miss();
    feedback.appendChild(el("p", { class: "feedback-text bad" }, explainWrong(state.level, item, correctPattern)));
    feedback.appendChild(playAudioButton(item.word, "▶ Hear it again"));
    if (attemptNumber >= MAX_ATTEMPTS_PER_WORD) {
      feedback.appendChild(el("p", { class: "feedback-text muted" }, "That's three tries on this one — let's move on for now."));
    }
  }

  const goBtn = el(
    "button",
    {
      class: "btn btn-primary",
      onclick: () => {
        advanceDrillIndex(drill);
        renderCurrentStage();
      }
    },
    "Next word →"
  );
  feedback.appendChild(goBtn);
}

// ---- Stage 3: Production -------------------------------------------------

function renderProduction() {
  const level = state.level;
  if (!state.production.queue.length) {
    state.production.queue = shuffle(productionWordList(level).map((w) => ({ word: w })));
    state.production.i = 0;
  }
  const p = state.production;
  Recorder.discardUrl(); // never carry a recording across renders

  if (p.i >= p.queue.length) {
    Recorder.releaseMic();
    root.appendChild(
      el("div", { class: "card" }, [
        el("h2", {}, "Speaking — done"),
        el("button", { class: "btn btn-primary", onclick: nextStage }, "Continue to spelling →")
      ])
    );
    return;
  }

  const item = p.queue[p.i];
  const card = el("div", { class: "card" }, [
    el("div", { class: "progress-line" }, `Word ${p.i + 1} of ${p.queue.length}`),
    el("h2", {}, "Say this word aloud"),
    el("div", { class: "example-word big" }, item.word)
  ]);

  const hint = el("div", { class: "muted hint" }, "Record yourself and play a recording back to unlock \"Next word\".");
  const nextBtn = el(
    "button",
    { class: "btn btn-primary", disabled: "true", onclick: () => advanceProduction() },
    "Next word →"
  );
  function unlockNext() {
    nextBtn.disabled = false;
    hint.textContent = "";
  }

  // Shared fallback for "no mic on this device", "permission denied", and
  // the explicit "No microphone" button below — same UI, same unlock rule:
  // Next stays locked until they've actually pressed play on something.
  function renderNoMicFallback(container, message, tone) {
    container.innerHTML = "";
    if (message) container.appendChild(el("p", { class: `feedback-text ${tone || "muted"}` }, message));
    const modelBtn = playAudioButton(item.word, "▶ Hear the model version");
    modelBtn.addEventListener("click", unlockNext);
    container.appendChild(modelBtn);
  }

  if (!Recorder.supported) {
    renderNoMicFallback(
      card,
      "Recording isn't supported in this browser, so you can only listen to the model version below.",
      "bad"
    );
    card.appendChild(hint);
    card.appendChild(nextBtn);
    root.appendChild(card);
    return;
  }

  const recordArea = el("div", { class: "record-area" });
  const recordBtn = el("button", { class: "btn btn-record" }, "● Record");
  const noMicBtn = el("button", { class: "btn btn-secondary" }, "No microphone");
  const status = el("div", { class: "record-status" }, "");
  const playbackRow = el("div", { class: "playback-row" });

  let recording = false;
  let awardedThisWord = false;

  noMicBtn.addEventListener("click", () => {
    renderNoMicFallback(recordArea, "No problem — just listen to the model version instead.");
    playbackRow.innerHTML = "";
  });

  recordBtn.addEventListener("click", async () => {
    if (recording) return;
    recording = true;
    recordBtn.disabled = true;
    noMicBtn.disabled = true;
    status.textContent = "Recording… tap stop when done.";
    playbackRow.innerHTML = ""; // clear any previous take while re-recording

    const stopBtn = el("button", { class: "btn btn-record-stop" }, "■ Stop");
    recordArea.appendChild(stopBtn);

    try {
      await Recorder.start();
    } catch (err) {
      renderNoMicFallback(recordArea, "Microphone access was denied or unavailable — listen to the model version instead.", "bad");
      recording = false;
      return;
    }

    stopBtn.addEventListener(
      "click",
      async () => {
        stopBtn.disabled = true;
        status.textContent = "Processing…";
        const url = await Recorder.stopAndGetUrl();
        stopBtn.remove();

        if (!url) {
          status.textContent = "Something went wrong with that recording — try again.";
        } else {
          status.textContent = "Got it — compare below.";
          playbackRow.innerHTML = "";
          playbackRow.appendChild(el("div", { class: "playback-label" }, "Your recording:"));
          const ownAudio = el("audio", { controls: "true", src: url });
          ownAudio.addEventListener("play", unlockNext);
          playbackRow.appendChild(ownAudio);
          playbackRow.appendChild(el("div", { class: "playback-label" }, "Model version:"));
          const modelBtn = playAudioButton(item.word, "▶ Play model version");
          modelBtn.addEventListener("click", unlockNext);
          playbackRow.appendChild(modelBtn);
          if (!awardedThisWord) {
            awardedThisWord = true;
            awardPoints(5);
          }
        }

        recordBtn.textContent = "● Record again";
        recordBtn.disabled = false;
        noMicBtn.disabled = false;
        recording = false;
      },
      { once: true }
    );
  });

  recordArea.appendChild(recordBtn);
  recordArea.appendChild(noMicBtn);
  recordArea.appendChild(status);
  card.appendChild(recordArea);
  card.appendChild(playbackRow);
  card.appendChild(hint);
  card.appendChild(nextBtn);

  root.appendChild(card);
}

function advanceProduction() {
  Recorder.discardUrl(); // delete recording as soon as we move on — never persisted
  state.production.i++;
  renderCurrentStage();
}

// ---- Stage 4: Spelling -----------------------------------------------------
// Attempts 1 and 2: type the whole word from hearing it.
// Final attempt (MAX_ATTEMPTS_PER_WORD): the word's own letters are given,
// shuffled, and the student just puts them in order.

function renderSpelling() {
  const level = state.level;
  if (!state.spelling.drill) {
    state.spelling.drill = newDrillState(spellingDrillItems(level));
  }
  const drill = state.spelling.drill;

  if (isDrillDone(drill)) {
    // Aftermath: the same splatter, rebuilt still, so the summary shows the
    // mess they actually made rather than a fresh avocado.
    const aftermath = Scenes.hammer({
      total: drill.totalWords,
      charge: state.game.hammer,
      smashed: state.game.smashed,
      ratio: state.game.ratio
    });
    root.appendChild(
      drillSummaryCard(drill, "Spelling", nextStage, "Continue to the dictation →", aftermath.node)
    );
    return;
  }

  const item = currentDrillItem(drill);
  const attemptNumber = (drill.attempts[drillKey(item)] || 0) + 1;
  const scene = Scenes.hammer({ total: drill.totalWords, charge: state.game.hammer });

  if (attemptNumber < MAX_ATTEMPTS_PER_WORD) renderSpellingTyping(item, drill, attemptNumber, scene);
  else renderSpellingArrange(item, drill, attemptNumber, scene);
}

// ---- shared bits across both spelling attempt-types ------------------------

function appendSpellingHeader(card, drill, attemptNumber) {
  if (drill.idx === 0 && drill.roundNumber > 1) {
    card.appendChild(el("div", { class: "round-banner" }, "Let's try the ones you missed again."));
  }
  card.appendChild(
    el(
      "div",
      { class: "progress-line" },
      `Word ${drill.idx + 1} of ${drill.round.length}` +
        (attemptNumber > 1 ? ` — attempt ${attemptNumber} of ${MAX_ATTEMPTS_PER_WORD}` : "")
    )
  );
}

function spellingNextWordButton(drill, label) {
  return el(
    "button",
    {
      class: "btn btn-primary",
      onclick: () => {
        advanceDrillIndex(drill);
        renderCurrentStage();
      }
    },
    label || "Next word →"
  );
}

// Takes an options object rather than a positional list — it had grown to
// eight arguments and the hammer scene made nine.
// o = { feedback, correct, item, correctPattern, attemptNumber, drill, points, scene }
function appendSpellingResultFeedback(o) {
  const feedback = o.feedback;
  feedback.innerHTML = "";

  if (o.correct) {
    registerCorrectStreak();
    awardPoints(o.points);
    state.game.hammer++;
    o.scene.chargeUp();
    feedback.appendChild(el("p", { class: "feedback-text good" }, pickAffirmation()));
  } else {
    registerWrongStreak();
    feedback.appendChild(
      el("p", { class: "feedback-text bad" }, explainWrong(state.level, o.item, o.correctPattern))
    );
    if (o.attemptNumber >= MAX_ATTEMPTS_PER_WORD) {
      feedback.appendChild(el("p", { class: "feedback-text muted" }, "That's three tries on this one — let's move on for now."));
    }
  }

  // Is that the last question of the stage? recordDrillAnswer() has already
  // run by now, so nextRound is settled: if the current round is finished
  // and nothing is queued for a retry, advanceDrillIndex() ends the drill.
  const isLast = o.drill.idx + 1 >= o.drill.round.length && o.drill.nextRound.length === 0;
  const ratio = o.drill.totalWords ? state.game.hammer / o.drill.totalWords : 0;

  const nextBtn = spellingNextWordButton(
    o.drill,
    isLast ? (ratio > 0 ? "See the damage →" : "Finish spelling →") : "Next word →"
  );
  feedback.appendChild(nextBtn);

  if (isLast) {
    state.game.smashed = true;
    state.game.ratio = ratio;
    // Held shut for the length of the swing so nobody clicks past the one
    // moment the whole stage has been building to.
    nextBtn.disabled = true;
    o.scene.smash(ratio).then(() => {
      feedback.insertBefore(el("p", { class: "verdict" }, Scenes.verdictFor(ratio).headline), nextBtn);
      nextBtn.disabled = false;
    });
  }
}

// ---- Attempts 1-2: type the whole word -------------------------------------

function renderSpellingTyping(item, drill, attemptNumber, scene) {
  const level = state.level;
  const correctPattern = patternOf(level, item.pattern);

  const card = el("div", { class: "card" });
  card.appendChild(scene.node);
  appendSpellingHeader(card, drill, attemptNumber);
  card.appendChild(el("h2", {}, "Spell it — type the whole word"));
  card.appendChild(playAudioButton(item.word, "▶ Hear the word"));

  const input = el("input", {
    class: "text-input mono",
    type: "text",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    placeholder: "Type the word…"
  });
  const submitBtn = el("button", { class: "btn btn-primary" }, "Check");
  const feedback = el("div", { class: "feedback", id: "spelling-feedback" });

  function submit() {
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    input.disabled = true;
    const correct = input.value.trim().toLowerCase() === item.word.toLowerCase();
    const attemptNum = recordDrillAnswer(drill, item, correct);
    appendSpellingResultFeedback({
      feedback: feedback,
      correct: correct,
      item: item,
      correctPattern: correctPattern,
      attemptNumber: attemptNum,
      drill: drill,
      points: attemptNum === 1 ? 10 : 5,
      scene: scene
    });
  }

  submitBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  card.appendChild(el("div", { class: "type-row" }, [input, submitBtn]));
  card.appendChild(feedback);

  root.appendChild(card);
  input.focus();
}

// ---- Final attempt: letters given, put them in order -----------------------

function shuffledLetters(word) {
  const letters = Array.from(word).map((ch, i) => ({ ch, id: i }));
  if (letters.length <= 1) return letters;
  let attempt;
  do {
    attempt = shuffle(letters);
  } while (attempt.map((t) => t.ch).join("") === word);
  return attempt;
}

function renderSpellingArrange(item, drill, attemptNumber, scene) {
  const level = state.level;
  const correctPattern = patternOf(level, item.pattern);

  const card = el("div", { class: "card" });
  card.appendChild(scene.node);
  appendSpellingHeader(card, drill, attemptNumber);
  card.appendChild(el("h2", {}, "Spell it — put the letters in order"));
  card.appendChild(el("p", { class: "muted" }, "Here are the letters, out of order. Tap them into place; tap a placed letter to take it back out."));
  card.appendChild(playAudioButton(item.word, "▶ Hear the word"));

  const tiles = shuffledLetters(item.word); // [{ ch, id }]
  const tileChar = (id) => tiles.find((t) => t.id === id).ch;
  let bank = tiles.map((t) => t.id);
  let answer = [];
  let checked = false;

  const answerRow = el("div", { class: "arrange-answer" });
  const bankRow = el("div", { class: "arrange-bank" });
  const controls = el("div", { class: "arrange-controls" });
  const feedback = el("div", { class: "feedback", id: "spelling-feedback" });

  function redraw() {
    answerRow.innerHTML = "";
    answer.forEach((id) => {
      const attrs = { class: "btn tile tile-answer mono" };
      if (checked) attrs.disabled = "true";
      const tileBtn = el("button", attrs, tileChar(id));
      if (!checked) {
        tileBtn.addEventListener("click", () => {
          answer = answer.filter((a) => a !== id);
          bank.push(id);
          redraw();
        });
      }
      answerRow.appendChild(tileBtn);
    });
    for (let i = answer.length; i < tiles.length; i++) {
      answerRow.appendChild(el("div", { class: "tile tile-empty" }, ""));
    }

    bankRow.innerHTML = "";
    if (!checked) {
      bank.forEach((id) => {
        const tileBtn = el("button", { class: "btn tile tile-bank mono" }, tileChar(id));
        tileBtn.addEventListener("click", () => {
          bank = bank.filter((b) => b !== id);
          answer.push(id);
          redraw();
          if (answer.length === tiles.length) submit();
        });
        bankRow.appendChild(tileBtn);
      });
    }

    controls.innerHTML = "";
    if (answer.length > 0 && !checked) {
      controls.appendChild(
        el(
          "button",
          {
            class: "btn btn-secondary",
            onclick: () => {
              answer = [];
              bank = tiles.map((t) => t.id);
              redraw();
            }
          },
          "Clear"
        )
      );
    }
  }

  function submit() {
    checked = true;
    redraw();
    const correct = answer.map(tileChar).join("") === item.word;
    recordDrillAnswer(drill, item, correct);
    appendSpellingResultFeedback({
      feedback: feedback,
      correct: correct,
      item: item,
      correctPattern: correctPattern,
      attemptNumber: attemptNumber,
      drill: drill,
      points: 5,
      scene: scene
    });
  }

  card.appendChild(answerRow);
  card.appendChild(bankRow);
  card.appendChild(controls);
  card.appendChild(feedback);

  root.appendChild(card);
  redraw();
}

// ---- Stage 5: Final dictation (not graded) --------------------------------
// Each word can be played individually, and slowly, as many times as
// needed. The app doesn't check spelling here — the student writes each
// word in their homework book and the teacher marks it.

function renderFinal() {
  const level = state.level;
  const dictation = level.dictation;

  const card = el("div", { class: "card" }, [
    el("h2", {}, "Final dictation"),
    el("p", {}, dictation.instructions)
  ]);

  const list = el("div", { class: "dictation-list" });
  dictation.words.forEach((word, i) => {
    const row = el("div", { class: "dictation-row" + (dictationPlayed.has(word) ? " played" : "") });
    row.appendChild(el("div", { class: "dictation-number" }, `${i + 1}.`));
    const btn = playAudioButton(word, "▶ Play slowly", 0.6);
    btn.addEventListener("click", () => {
      if (!dictationPlayed.has(word)) {
        dictationPlayed.add(word);
        awardPoints(5);
      }
      row.classList.add("played");
    });
    row.appendChild(btn);
    list.appendChild(row);
  });
  card.appendChild(list);

  card.appendChild(
    el("div", { class: "sentence-note" }, "The app doesn't mark this one — your teacher will check your Homework book.")
  );

  card.appendChild(
    el("button", { class: "btn btn-primary", onclick: () => finishLevel() }, "I've written them down — finish level")
  );

  root.appendChild(card);
}

function finishLevel() {
  const level = state.level;
  const missed = [
    ...(state.discrimination.drill ? state.discrimination.drill.movedOn : []),
    ...(state.spelling.drill ? state.spelling.drill.movedOn : [])
  ];
  const uniqueMissed = [...new Set(missed.map((m) => m.word))];

  root.innerHTML = "";
  root.appendChild(
    el("div", { class: "card complete-card" }, [
      el("h2", {}, "Level complete"),
      el("p", {}, `"${level.patternA.grapheme}" vs "${level.patternB.grapheme}" — all ${state.stages.length} stages done.`),
      el("p", { class: "stars" }, `★ ${state.score} points   —   best streak 🔥 ${state.bestStreak}`),
      el(
        "p",
        { class: "muted" },
        `Fish caught: ${state.game.fish}. Avocado: ${Scenes.verdictFor(state.game.ratio).headline}`
      ),
      el(
        "p",
        { class: "muted" },
        dictationPlayed.size
          ? `Played ${dictationPlayed.size} / ${level.dictation.words.length} dictation words — go write them up.`
          : "Note: none of the dictation words were played."
      ),
      uniqueMissed.length
        ? el("p", { class: "muted" }, "Words to revisit next time: " + uniqueMissed.join(", "))
        : null,
      el("button", { class: "btn btn-secondary", onclick: restart }, "Restart this level")
    ])
  );
}

function restart() {
  state.stageIndex = 0;
  state.discrimination = { drill: null };
  state.production = { queue: [], i: 0 };
  state.spelling = { drill: null };
  state.score = 0;
  state.streak = 0;
  state.bestStreak = 0;
  state.game = { fish: 0, hammer: 0, smashed: false, ratio: 0 };
  dictationPlayed.clear();
  Recorder.discardUrl();
  Recorder.releaseMic();
  renderScoreboard();
  renderStageDots();
  renderCurrentStage();
}

// ---- Boot ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", init);
