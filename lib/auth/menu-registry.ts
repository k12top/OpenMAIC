/**
 * Single source of truth for every menu / route / feature surface that
 * participates in the Casdoor-backed RBAC system. Each entry is identified
 * by a stable {@link MenuItem.id} (dot-separated namespacing — never rename
 * once a deploy has policies referencing it) and ships with optional
 * metadata for the admin browser, route-level guards, and the classroom
 * owner-bypass behavior.
 *
 * The casbin policy layer evaluates `(subject, domain, menuId, op)` where
 * `op` is one of {@link MENU_OPS}. The default mapping in
 * `lib/auth/menu-enforcer.ts` looks up the resulting boolean from this
 * registry, so adding a new feature surface that should be controllable by
 * admins is a matter of appending to {@link MENUS}.
 */

/** Two operations every menu can be gated against. */
export const MENU_OPS = ['visible', 'operable'] as const;
export type MenuOp = (typeof MENU_OPS)[number];

export interface MenuItem {
  /**
   * Stable identifier. Dot-separated namespacing (`area.itemName`) so the
   * admin UI can render a tree. NEVER change once shipped — Casdoor
   * policies reference this verbatim.
   */
  id: string;
  /** i18n key — convention is `menu.<id>` so it is easy to find. */
  labelKey: string;
  /**
   * Optional path for route-level guarding. Use the Next.js dynamic-segment
   * notation so the registry doubles as documentation
   * (`/classroom/[id]`, `/share/[token]`, ...).
   */
  route?: string;
  /** Parent `id` for tree rendering in the admin browser. */
  parent?: string;
  /**
   * Whether the **classroom owner** automatically gets `operable` on this
   * menu (the existing implicit-owner behavior). Defaults to `true`. Set
   * to `false` for destructive / admin-only items so even the owner has to
   * be granted permission explicitly.
   */
  ownerBypass?: boolean;
}

export const MENUS: readonly MenuItem[] = [
  // ── Routes ──────────────────────────────────────────────────────────
  { id: 'route.home', labelKey: 'menu.route.home', route: '/' },
  { id: 'route.classroom', labelKey: 'menu.route.classroom', route: '/classroom/[id]' },
  { id: 'route.share', labelKey: 'menu.route.share', route: '/share/[token]' },
  { id: 'route.credits', labelKey: 'menu.route.credits', route: '/credits' },
  { id: 'route.recharge', labelKey: 'menu.route.recharge', route: '/credits/recharge' },
  { id: 'route.generation', labelKey: 'menu.route.generation', route: '/generation-preview' },

  // ── Home page ───────────────────────────────────────────────────────
  { id: 'home.generate', labelKey: 'menu.home.generate' },
  // Destructive, even owners need an explicit grant.
  {
    id: 'home.deleteClassroom',
    labelKey: 'menu.home.deleteClassroom',
    ownerBypass: false,
  },
  { id: 'home.renameClassroom', labelKey: 'menu.home.renameClassroom' },

  // ── Stage header ────────────────────────────────────────────────────
  { id: 'header.share', labelKey: 'menu.header.share' },
  // Sub-permission for the "Classroom (lecture) mode" toggle inside the
  // share dialog. Hidden when the viewer lacks `operable`, so deploys can
  // restrict it to teacher roles even when the parent share action is
  // granted broadly. Owner-bypass keeps classroom owners in control of
  // their own classrooms (matches the existing toolbar.lectureMode entry).
  {
    id: 'header.share.lectureMode',
    labelKey: 'menu.header.shareLectureMode',
    parent: 'header.share',
  },
  { id: 'header.sync', labelKey: 'menu.header.sync' },
  { id: 'header.export', labelKey: 'menu.header.export' },

  // ── Scene sidebar ───────────────────────────────────────────────────
  // Parent menu — must be visible+operable for the "+" affordance to
  // appear at all. Sub-permissions below refine which scene type and
  // which insertion position the viewer is allowed to use.
  { id: 'sidebar.addScene', labelKey: 'menu.sidebar.addScene' },
  // Per-type sub-permissions. visible=false hides the type tile in
  // AddSceneDialog entirely; operable=false renders it locked. `pbl` is
  // intentionally absent — it's only produced by the initial generation
  // pipeline and never offered through AddSceneDialog.
  // NOTE: i18n labels for these sub-permissions are sibling keys under
  // `menu.sidebar` rather than nested under `menu.sidebar.addScene`,
  // because the parent label is already a string and JSON cannot mix
  // string + object at the same path.
  {
    id: 'sidebar.addScene.slide',
    labelKey: 'menu.sidebar.addSceneSlide',
    parent: 'sidebar.addScene',
  },
  {
    id: 'sidebar.addScene.quiz',
    labelKey: 'menu.sidebar.addSceneQuiz',
    parent: 'sidebar.addScene',
  },
  {
    id: 'sidebar.addScene.interactive',
    labelKey: 'menu.sidebar.addSceneInteractive',
    parent: 'sidebar.addScene',
  },
  // Per-position sub-permissions. `append` covers the bottom "+ Add
  // page" button (always at the end); `insert` covers the per-row
  // hover-reveal "+" buttons that drop a page between two existing
  // ones. Granting only `append` lets a viewer extend the lesson
  // without disrupting the existing scene order.
  {
    id: 'sidebar.addScene.append',
    labelKey: 'menu.sidebar.addSceneAppend',
    parent: 'sidebar.addScene',
  },
  {
    id: 'sidebar.addScene.insert',
    labelKey: 'menu.sidebar.addSceneInsert',
    parent: 'sidebar.addScene',
  },
  { id: 'sidebar.reorderScenes', labelKey: 'menu.sidebar.reorderScenes' },
  { id: 'sidebar.deleteScene', labelKey: 'menu.sidebar.deleteScene' },

  // ── Canvas toolbar ──────────────────────────────────────────────────
  { id: 'toolbar.regenerate', labelKey: 'menu.toolbar.regenerate' },
  { id: 'toolbar.editSource', labelKey: 'menu.toolbar.editSource' },
  { id: 'toolbar.lectureMode', labelKey: 'menu.toolbar.lectureMode' },

  // ── Settings dialog sections ────────────────────────────────────────
  { id: 'settings.providers', labelKey: 'menu.settings.providers' },
  { id: 'settings.image', labelKey: 'menu.settings.image' },
  { id: 'settings.video', labelKey: 'menu.settings.video' },
  { id: 'settings.tts', labelKey: 'menu.settings.tts' },
  { id: 'settings.asr', labelKey: 'menu.settings.asr' },
  { id: 'settings.pdf', labelKey: 'menu.settings.pdf' },
  { id: 'settings.webSearch', labelKey: 'menu.settings.webSearch' },
  { id: 'settings.general', labelKey: 'menu.settings.general' },

  // Per-user / per-classroom AI agent rename surface (settings panel,
  // reveal modal, classroom agent bar). Visible controls who SEES the
  // pencil affordance; operable controls who can actually save a rename.
  { id: 'settings.agents', labelKey: 'menu.settings.agents' },

  // Real-person learner profile (avatar / nickname / bio). Editable from
  // the home page profile card and the Settings dialog Profile section.
  { id: 'settings.profile', labelKey: 'menu.settings.profile' },
];

/** Lookup table for O(1) registry queries. */
export const MENUS_BY_ID: ReadonlyMap<string, MenuItem> = new Map(
  MENUS.map((m) => [m.id, m]),
);

/** Subset of menus that have a concrete route (used by middleware). */
export const ROUTE_MENUS: readonly MenuItem[] = MENUS.filter((m) => !!m.route);

/**
 * Resolve a request pathname to the matching menu_id, if any.
 * Handles Next.js dynamic segments by treating `[param]` as a wildcard
 * `[^/]+`. Returns the most specific match (longest pattern wins).
 */
export function resolveRouteMenuId(pathname: string): string | null {
  let best: { id: string; specificity: number } | null = null;
  for (const menu of ROUTE_MENUS) {
    if (!menu.route) continue;
    const pattern = menu.route.replace(/\[[^\]]+\]/g, '[^/]+');
    const re = new RegExp(`^${pattern}$`);
    if (re.test(pathname)) {
      // Specificity: number of literal (non-wildcard) segments.
      const specificity = menu.route.split('/').filter((s) => s && !s.startsWith('[')).length;
      if (!best || specificity > best.specificity) {
        best = { id: menu.id, specificity };
      }
    }
  }
  return best?.id ?? null;
}
