"use strict";

const game = document.querySelector("#game");
const stage = document.querySelector("#stage");
const mouth = document.querySelector("#mouth-target");
const speech = document.querySelector("#speech");
const mood = document.querySelector("#mood");
const burst = document.querySelector("#burst");
const source = document.querySelector("#food-source");
const bowl = source.querySelector(".bowl-art");
const bowlLabel = document.querySelector("#bowl-label");
const feedButton = document.querySelector("#feed-button");
const feedLabel = document.querySelector("#feed-label");
const resetButton = document.querySelector("#reset-button");
const soundButton = document.querySelector("#sound-button");
const soundLabel = document.querySelector("#sound-label");
const meter = document.querySelector("#meter");
const count = document.querySelector("#count");
const pips = Array.from(document.querySelectorAll(".pips i"));
const wallet = document.querySelector("#wallet");
const foodButtons = Array.from(document.querySelectorAll(".food-option"));
const againButton = document.querySelector("#again-button");
const kibble = document.querySelector("#kibble");
const announcement = document.querySelector("#announcement");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const gestureSheet = document.querySelector("#coal-gesture-sheet");
const openingTime = 200;
// The waiting pose and the bite are adjacent frames in the source shot.
const openingFrames = [0, 1, 2, 3, 4, 5];
const withdrawalFrames = [6, 7, 8, 9, 10];
const chewingFrames = Array.from({ length: 27 }, (_, index) => index + 6);
const lickingFrames = Array.from({ length: 12 }, (_, index) => index + 33);

const foods = {
  basic: { price: 0, successPercent: 70, name: "普通粮", pickup: "按住捏一颗" },
  premium: { price: 2, successPercent: 80, name: "高级粮", pickup: "按住捏一颗" },
  tube: { price: 3, successPercent: 88, name: "猫条", pickup: "按住取一点" },
  tin: { price: 4, successPercent: 95, name: "猫罐头", pickup: "按住取一口" },
  meat: { price: 5, successPercent: 100, name: "生肉", pickup: "按住拿一块" },
};
const bitesPerRound = pips.length;
const afterBite = ["好吃～", "再来一口？", "真香！", "还想吃～", "最后一口！"];

let bites = 0;
let coins = 8;
let recipe = "basic";
let phase = "ready";
let round = 0;
let hand = null;
let ignorePointerClick = false;
let flight = null;
let motion = null;
let sound = false;
let audioContext;
let crunchBuffer;

function updateProgress() {
  count.textContent = bites;
  meter.setAttribute("aria-valuenow", bites);
  meter.setAttribute("aria-valuetext", `吃了 ${bites} 口，共 ${bitesPerRound} 口`);
  pips.forEach((pip, index) => pip.classList.toggle("filled", index < bites));
}

function updateShop() {
  wallet.textContent = coins;
  source.dataset.recipe = recipe;
  source.setAttribute("aria-label", `${foods[recipe].name}，按住拖动或点击拿起`);
  if (phase === "ready") bowlLabel.textContent = foods[recipe].pickup;
  for (const option of foodButtons) {
    const type = option.dataset.food;
    option.setAttribute("aria-pressed", type === recipe);
    option.disabled = phase === "feeding" || phase === "holding" || coins < foods[type].price;
  }
}

function setPhase(next) {
  phase = next;
  const holding = phase === "holding";
  const dragging = holding && hand.pointerId !== null;
  const feeding = phase === "feeding";
  const full = phase === "full";
  const mouthClickable = holding && !dragging;
  const actionFocused = [source, feedButton, mouth].includes(document.activeElement);
  game.classList.toggle("is-holding", holding);
  game.classList.toggle("is-dragging", dragging);
  game.classList.toggle("is-feeding", feeding);
  game.classList.toggle("is-full", full);
  if (!holding) game.classList.remove("is-targeting");

  mouth.tabIndex = mouthClickable ? 0 : -1;
  mouth.setAttribute("aria-disabled", !mouthClickable);
  feedButton.setAttribute("aria-disabled", feeding || dragging);
  source.setAttribute("aria-disabled", feeding);
  source.hidden = full;
  feedButton.hidden = full;
  againButton.hidden = !full;

  if (holding) {
    mood.textContent = "正在送粮";
    feedLabel.textContent = "送到嘴边";
    bowlLabel.textContent = dragging ? "送到嘴边再松手" : "已拿起，点碗可放回";
  } else if (feeding) {
    mood.textContent = "正在接粮";
    feedLabel.textContent = "投喂中…";
    bowlLabel.textContent = "小猫正在接粮";
  } else {
    mood.textContent = full ? "吃饱啦" : "等你投喂";
    feedLabel.textContent = "拿起食物";
  }
  if (full && actionFocused) againButton.focus({ preventScroll: true });
  updateShop();
}

function mouthCenter() {
  const rect = mouth.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function bowlCenter() {
  const rect = bowl.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height * .32 };
}

function reach(point, closeRadius = 1.6) {
  const target = mouthCenter();
  const distance = Math.hypot(point.x - target.x, point.y - target.y);
  const width = mouth.getBoundingClientRect().width;
  return { close: distance <= width * closeRadius, inMouth: distance <= width * .51 };
}

function pointerPoint(event) {
  const lift = event.pointerType === "touch" ? 26 : 0;
  return { x: event.clientX, y: event.clientY - lift };
}

function kibblePose(point, angle = -14, scale = 1) {
  return `translate3d(${point.x}px, ${point.y}px, 0) rotate(${angle}deg) scale(${scale})`;
}

function positionKibble(point) {
  kibble.hidden = false;
  kibble.style.transform = kibblePose(point);
}

function stopKibble() {
  kibble.hidden = true;
  flight?.cancel();
  flight = null;
}

async function animateKibble(keyframes, duration, easing) {
  stopKibble();
  if (reducedMotion.matches || !kibble.animate) return true;

  kibble.hidden = false;
  const animation = kibble.animate(keyframes, { duration, easing, fill: "forwards" });
  flight = animation;
  await animation.finished.catch(() => {});
  if (flight !== animation) return false;
  stopKibble();
  return true;
}

function moveKibble(from, to, duration) {
  return animateKibble([
    { transform: kibblePose(from) },
    { transform: kibblePose(to, 8, .79) },
  ], duration, "cubic-bezier(.22,.65,.44,1)");
}

function feedKibble(from, to, duration) {
  return animateKibble([
    { transform: kibblePose(from), opacity: 1, offset: 0 },
    { transform: kibblePose(to, 5, .84), opacity: 1, offset: .76 },
    { transform: kibblePose({ x: to.x, y: to.y - 3 }, 10, .32), opacity: 0, offset: 1 },
  ], duration, "cubic-bezier(.24,.63,.46,1)");
}

function spillKibble(from, direction) {
  const rect = stage.getBoundingClientRect();
  const floor = rect.bottom - 9;
  const fall = Math.max(30, floor - from.y);
  const drift = Math.min(29, rect.width * .08);
  const x = (distance) => Math.max(rect.left + 12, Math.min(rect.left + rect.width - 12, from.x + direction * distance));
  const lipCover = (amount) => direction < 0 ? `inset(0 ${amount}% 0 0)` : `inset(0 0 0 ${amount}%)`;
  return animateKibble([
    { transform: kibblePose(from, direction * 8, .78), clipPath: lipCover(70), opacity: 0, offset: 0 },
    { transform: kibblePose({ x: x(2), y: from.y + 2 }, direction * 12, .82), clipPath: lipCover(39), opacity: 1, offset: .14 },
    { transform: kibblePose({ x: x(4), y: from.y + 4 }, direction * 20, .82), clipPath: lipCover(23), opacity: 1, offset: .4 },
    { transform: kibblePose({ x: x(8), y: from.y + 12 }, direction * 36, .8), clipPath: lipCover(0), opacity: 1, offset: .55 },
    { transform: kibblePose({ x: x(drift * .68), y: from.y + fall * .28 }, direction * 117, .79), clipPath: lipCover(0), opacity: 1, offset: .77 },
    { transform: kibblePose({ x: x(drift), y: floor - 12 }, direction * 239, .77), clipPath: lipCover(0), opacity: .9, offset: .94 },
    { transform: kibblePose({ x: x(drift + 3), y: floor }, direction * 268, .74), clipPath: lipCover(0), opacity: 0, offset: 1 },
  ], 860, "linear");
}
function pop(full = false) {
  if (reducedMotion.matches) return;
  const colors = ["#fff1c2", "#fdbb73", "#fc9871"];
  const pieces = full ? 12 : 3;

  for (let index = 0; index < pieces; index += 1) {
    const angle = -Math.PI * (index + .5) / pieces;
    const distance = (full ? 74 : 43) + (index % 3) * 12;
    const particle = document.createElement("i");
    particle.className = "particle";
    particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--y", `${Math.sin(angle) * distance - 12}px`);
    particle.style.setProperty("--turn", `${25 + index * 27}deg`);
    particle.style.setProperty("--particle-color", colors[index % colors.length]);
    particle.addEventListener("animationend", () => particle.remove(), { once: true });
    burst.append(particle);
  }
}

function activateAudio() {
  if (!sound) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  audioContext ||= new Audio();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
}

function crunch(strength) {
  if (!sound || audioContext?.state !== "running") return;
  const now = audioContext.currentTime;

  if (!crunchBuffer) {
    const size = Math.floor(audioContext.sampleRate * .065);
    crunchBuffer = audioContext.createBuffer(1, size, audioContext.sampleRate);
    const samples = crunchBuffer.getChannelData(0);
    for (let index = 0; index < size; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
  }

  const noise = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  noise.buffer = crunchBuffer;
  filter.type = "bandpass";
  filter.frequency.value = 1550 + Math.random() * 850;
  filter.Q.value = .75;
  gain.gain.setValueAtTime(.001, now);
  gain.gain.exponentialRampToValueAtTime(strength, now + .008);
  gain.gain.exponentialRampToValueAtTime(.001, now + .062);
  noise.connect(filter).connect(gain).connect(audioContext.destination);
  noise.start(now);
}

function chime() {
  if (!sound || audioContext?.state !== "running") return;
  [523.25, 659.25, 783.99].forEach((note, index) => {
    const time = audioContext.currentTime + index * .09;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = note;
    gain.gain.setValueAtTime(.001, time);
    gain.gain.exponentialRampToValueAtTime(.07, time + .012);
    gain.gain.exponentialRampToValueAtTime(.001, time + .24);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(time);
    oscillator.stop(time + .25);
  });
}

const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

function aim(point) {
  const place = reach(point, stage.dataset.frame === "open" ? 1.76 : 1.6);
  positionKibble(point);
  showMouth(place.close);
  game.classList.toggle("is-targeting", place.inMouth);
  speech.textContent = place.inMouth ? "现在松手！" : place.close ? "啊～" : "再靠近点～";
  mood.textContent = place.close ? "张嘴等粮" : "正在送粮";
}

function beginHold(active = null) {
  if (phase !== "ready") return;
  stopKibble();
  stopMotion();
  hand = active ?? { pointerId: null, point: bowlCenter() };
  kibble.dataset.food = recipe;
  setPhase("holding");
  positionKibble(hand.point);
  speech.textContent = "送到嘴边～";
  announcement.textContent = "已经拿起食物，送到小猫嘴边再松手。";
}

function releaseHand() {
  const previous = hand;
  hand = null;
  if (previous?.pointerId != null && source.hasPointerCapture(previous.pointerId)) {
    source.releasePointerCapture(previous.pointerId);
  }
}

function putBack(from) {
  releaseHand();
  showMouth(false);
  setPhase("ready");
  speech.textContent = from ? "再靠近点～" : "喵～";
  if (from) {
    void moveKibble(from, bowlCenter(), 220);
    announcement.textContent = "把食物送到嘴边再松手。";
  } else {
    stopKibble();
    announcement.textContent = "食物放回食盘了。";
  }
}

function stopMotion() {
  motion?.animation.cancel();
  motion = null;
  delete stage.dataset.motion;
}

function playMotion(name, frames, duration, { fadeIn = 0, fadeOut = 0 } = {}) {
  if (reducedMotion.matches || !gestureSheet.complete || !gestureSheet.naturalWidth ||
      typeof gestureSheet.animate !== "function") return false;

  stopMotion();
  const grid = 7;
  const keys = frames.map((tile, index) => ({
    transform: `translate3d(${-(tile % grid) * 100 / grid}%, ${-Math.floor(tile / grid) * 100 / grid}%, 0)`,
    opacity: Math.min(1, fadeIn ? index / fadeIn : 1, fadeOut ? (frames.length - 1 - index) / fadeOut : 1),
    offset: index / frames.length,
    easing: "steps(1, end)",
  }));
  keys.push({ ...keys[keys.length - 1], offset: 1 });
  try {
    const animation = gestureSheet.animate(keys, { duration, fill: "both" });
    motion = { name, animation };
    stage.dataset.motion = name;
    animation.onfinish = () => {
      if (motion?.animation === animation && name === "withdrawal") stopMotion();
    };
    return true;
  } catch {
    return false;
  }
}

function showMouth(open) {
  const next = open ? "open" : "idle";
  if (stage.dataset.frame === next) return;
  stage.dataset.frame = next;
  if (open) {
    playMotion("opening", openingFrames, openingTime);
    return;
  }
  const opened = motion?.name === "opening" && Number(motion.animation.currentTime) >= 130;
  if (!opened || !playMotion("withdrawal", withdrawalFrames, 165, { fadeOut: 2 })) stopMotion();
}

function openingRemaining() {
  if (motion?.name !== "opening") return 0;
  return Math.max(0, openingTime - Number(motion.animation.currentTime || 0));
}

async function chew(run) {
  const sourceFrames = playMotion("chew", chewingFrames, 900);
  if (!sourceFrames) stopMotion();
  const steps = sourceFrames ? [
    { pose: "close", wait: 85 },
    { pose: "chew", wait: 215, strength: .26 },
    { wait: 330, strength: .19 },
    { wait: 270, strength: .13 },
  ] : [
    { pose: "close", wait: 105 },
    { pose: "chew", wait: 154 },
    { wait: 156, strength: .28 },
    { wait: 145, strength: .21 },
    { wait: 285, strength: .15 },
  ];

  for (const { pose, wait, strength } of steps) {
    if (pose) stage.dataset.frame = pose;
    if (pose === "chew") {
      speech.textContent = "咔嚓咔嚓";
      mood.textContent = "正在嚼嚼";
      pop();
    }
    if (strength) crunch(strength);
    await delay(wait);
    if (run !== round) return;
  }
  stage.dataset.frame = "lick";
  mood.textContent = "舔舔嘴";
  if (!playMotion("lick", lickingFrames, 400, { fadeIn: 2, fadeOut: 2 })) stopMotion();
  await delay(reducedMotion.matches ? 260 : 400);
  if (run === round) stopMotion();
}

async function miss(point, direction, run) {
  if (!playMotion("spill", chewingFrames, 900)) stopMotion();
  stage.dataset.frame = "close";
  await delay(95);
  if (run !== round) return;

  stage.dataset.frame = "chew";
  speech.textContent = "咔嚓";
  mood.textContent = "正在嚼嚼";
  crunch(.18);
  await delay(170);
  if (run !== round) return;

  speech.textContent = "滑掉啦！";
  mood.textContent = "从嘴角滑掉了";
  await spillKibble(point, direction);
  if (run === round) stopMotion();
}

async function offer(from, dragged = false, aimed = true) {
  if (phase !== "holding") return;
  const grade = foods[recipe];
  const run = round;
  const target = mouthCenter();
  const width = mouth.getBoundingClientRect().width;
  releaseHand();
  activateAudio();
  setPhase("feeding");
  showMouth(true);
  speech.textContent = "啊呜！";

  const travelTime = Math.max(dragged ? 105 : 285, openingRemaining());
  const arrived = await feedKibble(from, target, travelTime);
  if (!arrived || run !== round) return;

  const caught = aimed && (grade.successPercent === 100 || Math.random() * 100 < grade.successPercent);
  coins -= grade.price;
  if (caught) {
    bites += 1;
    coins += 1;
    updateProgress();
  }
  if (coins < foods[recipe].price) recipe = "basic";
  updateShop();

  if (caught) {
    await chew(run);
  } else {
    const direction = !aimed && from.x > target.x ? 1 : -1;
    const corner = { x: target.x + direction * width * .34, y: target.y - width * .07 };
    await miss(corner, direction, run);
  }
  if (run !== round) return;

  stage.dataset.frame = "idle";
  if (bites === bitesPerRound) {
    setPhase("full");
    speech.textContent = "吃饱啦！";
    pop(true);
    chime();
    announcement.textContent = "小煤球吃饱啦，可以再喂一轮。";
  } else {
    setPhase("ready");
    if (caught) {
      speech.textContent = afterBite[bites - 1];
      announcement.textContent = `喂进一口，饱腹度 ${bites} / ${bitesPerRound}，奖励 1 金币。`;
    } else {
      announcement.textContent = `食物从嘴角滑掉了，饱腹度还是 ${bites} / ${bitesPerRound}。`;
    }
  }
}

function reset() {
  const restarting = document.activeElement === againButton;
  round += 1;
  bites = 0;
  releaseHand();
  stopKibble();
  stopMotion();
  stage.dataset.frame = "idle";
  speech.textContent = "喵～";
  burst.replaceChildren();
  updateProgress();
  setPhase("ready");
  if (restarting) feedButton.focus({ preventScroll: true });
  announcement.textContent = "新一轮开始，小煤球正在等你投喂。";
}

function useFeedButton() {
  if (phase === "ready") beginHold();
  else if (phase === "holding" && hand.pointerId === null) void offer(hand.point);
}

source.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  ignorePointerClick = false;
  if (phase !== "ready") return;
  beginHold({ pointerId: event.pointerId, origin: pointerPoint(event), point: bowlCenter(), moved: false });
  source.setPointerCapture(event.pointerId);
});

source.addEventListener("pointermove", (event) => {
  if (!hand || event.pointerId !== hand.pointerId) return;
  const point = pointerPoint(event);
  if (!hand.moved && Math.hypot(point.x - hand.origin.x, point.y - hand.origin.y) < 7) return;
  hand.point = point;
  hand.moved = true;
  aim(point);
});

source.addEventListener("pointerup", (event) => {
  if (!hand || event.pointerId !== hand.pointerId) return;
  ignorePointerClick = true;
  if (!hand.moved) {
    releaseHand();
    hand = { pointerId: null, point: bowlCenter() };
    setPhase("holding");
    return;
  }
  const point = pointerPoint(event);
  const place = reach(point);
  if (place.close) void offer(point, true, place.inMouth);
  else putBack(point);
});

function cancelDrag(event) {
  if (!hand || event.pointerId !== hand.pointerId) return;
  ignorePointerClick = true;
  putBack();
}
source.addEventListener("pointercancel", cancelDrag);
source.addEventListener("lostpointercapture", cancelDrag);

source.addEventListener("click", (event) => {
  if (ignorePointerClick && event.detail > 0) {
    ignorePointerClick = false;
    return;
  }
  if (phase === "ready") beginHold();
  else if (phase === "holding" && hand.pointerId === null) putBack();
});

mouth.addEventListener("click", () => {
  if (phase === "holding" && hand.pointerId === null) void offer(hand.point);
});

feedButton.addEventListener("click", useFeedButton);
resetButton.addEventListener("click", reset);
againButton.addEventListener("click", reset);
for (const option of foodButtons) {
  option.addEventListener("click", () => {
    if (option.disabled) return;
    recipe = option.dataset.food;
    updateShop();
    announcement.textContent = `已选择${foods[recipe].name}。`;
  });
}

soundButton.addEventListener("click", () => {
  sound = !sound;
  soundButton.setAttribute("aria-pressed", sound);
  soundLabel.textContent = sound ? "音效开" : "音效关";
  activateAudio();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && phase === "holding") {
    if (hand.pointerId !== null) ignorePointerClick = true;
    putBack();
  }
  if (phase === "full" || event.code !== "Space" || event.defaultPrevented || event.repeat ||
      event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest?.("button, a, input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
  useFeedButton();
});

updateProgress();
setPhase("ready");
