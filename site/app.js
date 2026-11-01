"use strict";

const panel = document.querySelector("#example");
const tabs = document.querySelector("#example-tabs");
const readable = (value) => value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function readRows(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Preview file unavailable");
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function showExample(example, answer) {
  const previous = panel.querySelector("audio");
  if (previous) previous.pause();
  panel.replaceChildren();
  const heading = element("div", "example-heading");
  const title = element("h3", "", example.title);
  title.id = "example-heading";
  heading.append(title, element("span", "", `${example.id.replace("example-", "Example ")} · ${example.duration_seconds.toFixed(2)} s`));
  const audio = element("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = `/preview/${example.audio}`;
  audio.setAttribute("aria-label", `${example.title} audio example`);
  audio.append(document.createTextNode("Your browser does not support audio playback. "));
  const download = element("a", "", "Download the audio clip");
  download.href = audio.src;
  audio.append(download);
  const question = example.audio_request.questions.action;
  const options = element("ol", "options");
  Object.entries(question.criteria).forEach(([id, description], index) => {
    const item = element("li");
    item.dataset.option = id;
    item.append(element("span", "option-letter", String.fromCharCode(65 + index)), element("span", "", description));
    options.append(item);
  });
  const details = element("details");
  details.append(element("summary", "", "Show annotated decision"));
  const annotated = element("p", "answer");
  annotated.append(element("strong", "", readable(answer.label)), element("small", "", "Human reference label"));
  details.append(annotated);
  panel.append(heading, audio, element("p", "context-label", "Context"),
    element("p", "example-context", example.audio_request.state.context),
    element("p", "question-label", "Question"), element("p", "question", question.instructions), options, details);
  panel.setAttribute("aria-busy", "false");
  for (const button of tabs.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.id === example.id));
  }
}

Promise.all([readRows("/preview/questions.jsonl"), readRows("/preview/answers.jsonl")])
  .then(([examples, answers]) => {
    const labels = new Map(answers.map((a) => [a.id, a]));
    if (examples.length !== 6 || labels.size !== 6) throw new Error("Invalid preview set");
    examples.forEach((example) => {
      if (!labels.has(example.id)) throw new Error("Missing preview answer");
      const button = element("button", "", example.title);
      button.type = "button";
      button.dataset.id = example.id;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-controls", "example");
      button.addEventListener("click", () => showExample(example, labels.get(example.id)));
      tabs.append(button);
    });
    showExample(examples[0], labels.get(examples[0].id));
  })
  .catch(() => {
    panel.setAttribute("aria-busy", "false");
    panel.replaceChildren(element("p", "", "The examples could not be loaded. Refresh the page, or open the public preview in the GitHub repository."));
  });

document.querySelector("#copy-citation").addEventListener("click", async () => {
  const button = document.querySelector("#copy-citation");
  const status = document.querySelector("#copy-status");
  try {
    await navigator.clipboard.writeText(document.querySelector("#bibtex").textContent);
    button.textContent = "Copied";
    status.textContent = "BibTeX citation copied to clipboard.";
    setTimeout(() => { button.textContent = "Copy BibTeX"; }, 2500);
  } catch {
    status.classList.remove("sr-only");
    status.textContent = "Select and copy the citation text below.";
  }
});
