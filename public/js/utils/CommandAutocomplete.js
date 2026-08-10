// ─────────────────────────────────────────────────────────────────────────────
// CommandAutocomplete — autocompletado de comandos estilo Minecraft.
//
// Utilidad reutilizable para cualquier input de consola del panel: muestra
// sugerencias mientras se escribe, completa con Tab (prefijo común o ciclo),
// navega con ↑/↓, inserta con Enter o click, cierra con Escape.
//
// Uso:
//   const ac = new CommandAutocomplete(inputEl, { container: boxEl });
//   ac.attach();
//   // ac.destroy() para limpiar
//
// Opciones:
//   container    – elemento donde se renderizan las sugerencias (se crea si falta)
//   commands     – lista [{ path, args }]; por defecto COMMANDS_DEFAULT
//   maxSuggestions – máx. sugerencias visibles (por defecto 12)
//   onInsert     – callback al insertar: (path) => {}
// ─────────────────────────────────────────────────────────────────────────────

const escapeHtml = (str) => String(str ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const COMMANDS_DEFAULT = [
  { path: "help", args: "[comando]" },
  { path: "say", args: "<mensaje>" },
  { path: "tell", args: "<jugador> <mensaje>" },
  { path: "msg", args: "<jugador> <mensaje>" },
  { path: "w", args: "<jugador> <mensaje>" },
  { path: "kick", args: "<jugador> [razón]" },
  { path: "ban", args: "<jugador> [razón]" },
  { path: "ban-ip", args: "<ip> [razón]" },
  { path: "pardon", args: "<jugador>" },
  { path: "pardon-ip", args: "<ip>" },
  { path: "banlist", args: "ips | players" },
  { path: "op", args: "<jugador>" },
  { path: "deop", args: "<jugador>" },
  { path: "tp", args: "<jugador> | <x> <y> <z>" },
  { path: "teleport", args: "<jugador> [x y z]" },
  { path: "gamemode", args: "survival | creative | adventure | spectator" },
  { path: "gmc", args: "[jugador]" },
  { path: "gms", args: "[jugador]" },
  { path: "gma", args: "[jugador]" },
  { path: "gmsp", args: "[jugador]" },
  { path: "defaultgamemode", args: "survival | creative | adventure | spectator" },
  { path: "time", args: "set | add | query" },
  { path: "time set", args: "day | night | noon | midnight | <tick>" },
  { path: "time add", args: "<ticks>" },
  { path: "time query", args: "daytime | gametime | day" },
  { path: "weather", args: "clear | rain | thunder [duración]" },
  { path: "difficulty", args: "peaceful | easy | normal | hard" },
  { path: "gamerule", args: "<regla> <valor>" },
  { path: "give", args: "<jugador> <item> [cantidad]" },
  { path: "clear", args: "[jugador] [item]" },
  { path: "effect", args: "give | clear" },
  { path: "effect give", args: "<jugador> <efecto> [segundos] [nivel]" },
  { path: "effect clear", args: "[jugador] [efecto]" },
  { path: "xp", args: "<cantidad> [jugador]" },
  { path: "experience", args: "add | set | query" },
  { path: "kill", args: "[jugador]" },
  { path: "killall", args: "[entidad]" },
  { path: "spawnpoint", args: "[jugador] [x y z]" },
  { path: "setworldspawn", args: "[x y z]" },
  { path: "seed", args: "" },
  { path: "save-all", args: "[flush]" },
  { path: "save-off", args: "" },
  { path: "save-on", args: "" },
  { path: "stop", args: "" },
  { path: "restart", args: "" },
  { path: "list", args: "" },
  { path: "pl", args: "" },
  { path: "plugins", args: "" },
  { path: "version", args: "" },
  { path: "reload", args: "" },
  { path: "whitelist", args: "add | remove | list | on | off | reload" },
  { path: "whitelist add", args: "<jugador>" },
  { path: "whitelist remove", args: "<jugador>" },
  { path: "summon", args: "<entidad> [x y z]" },
  { path: "setblock", args: "<x> <y> <z> <bloque>" },
  { path: "fill", args: "<x1> <y1> <z1> <x2> <y2> <z2> <bloque>" },
  { path: "locate", args: "structure | biome" },
  { path: "locate structure", args: "<estructura>" },
  { path: "locate biome", args: "<bioma>" },
  { path: "data", args: "get | merge | remove" },
  { path: "title", args: "<jugador> title | subtitle | actionbar | times | clear | reset" },
  { path: "bossbar", args: "add | remove | set | list" },
  { path: "scoreboard", args: "objectives | players | teams" },
  { path: "team", args: "add | remove | join | leave | empty" },
  { path: "attribute", args: "<jugador> <atributo> get | set" },
  { path: "particle", args: "<partícula> <x> <y> <z>" },
  { path: "playsound", args: "<sonido> <jugador>" },
  { path: "stopSound", args: "[jugador] [sonido]" },
  { path: "recipe", args: "give | take" },
  { path: "advancement", args: "grant | revoke" },
  { path: "function", args: "<nombre>" },
  { path: "worldborder", args: "set | center | add" },
  { path: "tps", args: "" },
  { path: "mspt", args: "" },
  { path: "timings", args: "report | on | off | paste" },
  { path: "spark", args: "profiler | tps | heapdump" },
  { path: "paper", args: "entity | mobcaps | chunks" },
  { path: "purpur", args: "reload | version" },
  { path: "debug", args: "start | stop | paste" },
  { path: "publish", args: "[puerto]" }
];

export class CommandAutocomplete {
  constructor(input, options = {}) {
    if (!input) throw new Error("CommandAutocomplete: se requiere un elemento input");
    this.input = input;
    this.container = options.container || null;
    this.commands = options.commands || COMMANDS_DEFAULT;
    this.maxSuggestions = options.maxSuggestions ?? 12;
    this.onInsert = typeof options.onInsert === "function" ? options.onInsert : null;
    this.list = [];
    this.active = -1;
    this.attached = false;
    this._handlers = { input: null, keydown: null, docClick: null };
  }

  /** Activa los listeners (idempotente). */
  attach() {
    if (this.attached) return this;
    this._ensureContainer();
    this._handlers.input = () => this.render(this.input.value);
    this._handlers.keydown = (e) => this._onKeydown(e);
    this._handlers.docClick = (e) => {
      if (!this.input.contains(e.target) && !(this.container && this.container.contains(e.target))) {
        this.hide();
      }
    };
    this.input.addEventListener("input", this._handlers.input);
    this.input.addEventListener("keydown", this._handlers.keydown);
    document.addEventListener("click", this._handlers.docClick);
    this.attached = true;
    return this;
  }

  /** Quita listeners y oculta las sugerencias. */
  destroy() {
    if (!this.attached) return;
    this.input.removeEventListener("input", this._handlers.input);
    this.input.removeEventListener("keydown", this._handlers.keydown);
    document.removeEventListener("click", this._handlers.docClick);
    this.hide();
    this.attached = false;
  }

  /** Renderiza las sugerencias para el texto actual del input. */
  render(typed) {
    this._clear();
    if (!typed) {
      this.hide();
      return;
    }
    const norm = typed.startsWith("/") ? typed.slice(1) : typed;
    const lower = norm.toLowerCase();
    this.list = this.commands
      .filter((c) => c.path.toLowerCase().startsWith(lower))
      .slice(0, this.maxSuggestions);

    if (this.list.length === 0) {
      this.container.innerHTML = '<div class="cmd-hint">Sin coincidencias...</div>';
      this.container.style.display = "block";
      return;
    }

    this.list.forEach((cmd, i) => {
      const row = document.createElement("div");
      row.className = "cmd-suggestion";
      row.innerHTML =
        `<span class="cmd-match">/${escapeHtml(cmd.path.slice(0, norm.length))}</span>` +
        `<span>${escapeHtml(cmd.path.slice(norm.length))}</span>` +
        (cmd.args ? `<span class="cmd-args">${escapeHtml(cmd.args)}</span>` : "");
      row.addEventListener("click", () => {
        this.insert(cmd.path, true);
        this.input.focus();
      });
      row.addEventListener("mousemove", () => {
        this.active = i;
        this._highlight();
      });
      this.container.appendChild(row);
    });
    this.container.style.display = "block";
  }

  /** Inserta un comando en el input y cierra las sugerencias. */
  insert(path, withSpace) {
    this.input.value = "/" + path + (withSpace ? " " : "");
    this.hide();
    if (this.onInsert) this.onInsert(path);
  }

  hide() {
    this._clear();
    if (this.container) this.container.style.display = "none";
  }

  // ── Privado ───────────────────────────────────────────────────────────────

  _ensureContainer() {
    if (this.container) return;
    const container = document.createElement("div");
    container.className = "cmd-suggestions";
    container.style.display = "none";
    this.input.parentElement.insertBefore(container, this.input);
    this.container = container;
  }

  _clear() {
    if (this.container) this.container.innerHTML = "";
    this.list = [];
    this.active = -1;
  }

  _highlight() {
    const rows = this.container.querySelectorAll(".cmd-suggestion");
    rows.forEach((r, i) => r.classList.toggle("active", i === this.active));
    if (this.active >= 0 && rows[this.active]) {
      rows[this.active].scrollIntoView({ block: "nearest" });
    }
  }

  static _commonPrefix(paths) {
    if (paths.length === 0) return "";
    let prefix = paths[0];
    for (const p of paths.slice(1)) {
      while (!p.startsWith(prefix)) prefix = prefix.slice(0, -1);
      if (!prefix) break;
    }
    return prefix;
  }

  _onKeydown(e) {
    const hasSug = this.container.style.display !== "none" && this.list.length > 0;

    if (e.key === "Tab" && hasSug) {
      e.preventDefault();
      const norm = this.input.value.replace(/^\/+/, "");
      if (this.active >= 0 && this.list[this.active]) {
        this.insert(this.list[this.active].path, true);
        return;
      }
      if (this.list.some((c) => c.path === norm)) {
        const idx = this.list.findIndex((c) => c.path === norm);
        this.active = (idx + 1) % this.list.length;
        this._highlight();
        return;
      }
      const prefix = CommandAutocomplete._commonPrefix(this.list.map((c) => c.path));
      if (prefix.length > norm.length) {
        this.insert(prefix, false);
        if (this.list.some((c) => c.path === prefix)) {
          this.input.value += " ";
        }
      } else {
        this.active = 0;
        this._highlight();
      }
      return;
    }

    if (e.key === "ArrowDown" && hasSug) {
      e.preventDefault();
      this.active = (this.active + 1) % this.list.length;
      this._highlight();
      return;
    }
    if (e.key === "ArrowUp" && hasSug) {
      e.preventDefault();
      this.active = (this.active - 1 + this.list.length) % this.list.length;
      this._highlight();
      return;
    }
    if (e.key === "Escape" && hasSug) {
      e.preventDefault();
      this.hide();
      return;
    }
    if (e.key === "Enter" && hasSug && this.active >= 0) {
      e.preventDefault();
      this.insert(this.list[this.active].path, true);
    }
  }
}
