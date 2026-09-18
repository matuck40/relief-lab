"use client";

import { ChangeEvent, DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ThreePreview } from "./components/three-preview";
import { suggestColorAssignments, toHexColor } from "./lib/color-palette";
import { download3mf, inspectReliefTopology } from "./lib/export-3mf";
import { buildReliefModel, Level, LevelHeights } from "./lib/relief-model";
import { ParsedSvgDocument, parseSvgDocument } from "./lib/svg-document";

type ViewMode = "2d" | "3d";
type SourceView = "colors" | "layers";
type Step = 1 | 2 | 3 | 4;
type LevelDefinition = { level: Level; name: string; tone: string; height: number };

const sampleColors = ["#f4f7fb", "#246bfd", "#26b7c9", "#ff6b6b"];
const initialLevelDefinitions: LevelDefinition[] = [
  { level: 0, name: "Base", tone: "base", height: 1.6 },
  { level: 1, name: "Nível 1", tone: "blue", height: 0.4 },
  { level: 2, name: "Nível 2", tone: "cyan", height: 0.4 },
  { level: 3, name: "Nível 3", tone: "coral", height: 0.2 },
];
const reliefTones = ["blue", "cyan", "coral", "violet", "lime", "orange"];
const EXCLUDED_LEVEL = -1;

function levelLabel(level: number) { return level === 0 ? "BASE" : `NÍVEL ${level}`; }
function mm(value: number) { return `${value.toFixed(2).replace(".", ",")} mm`; }
function colorLabel(value: string) {
  const hex = toHexColor(value).toUpperCase();
  return ({
    "#000000": "Preto", "#FFFFFF": "Branco", "#FF0000": "Vermelho",
    "#E63939": "Vermelho", "#0000FF": "Azul", "#233D6E": "Azul",
    "#878787": "Cinza", "#AFAFAF": "Cinza claro", "#EDE9DD": "Creme",
  } as Record<string, string>)[hex] ?? hex;
}

export default function Home() {
  const [parsed, setParsed] = useState<ParsedSvgDocument | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [sourceView, setSourceView] = useState<SourceView>("colors");
  const [activeStep, setActiveStep] = useState<Step>(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [shapeLevels, setShapeLevels] = useState<Record<string, Level[]>>({});
  const [colorAssignments, setColorAssignments] = useState<Record<string, string>>({});
  const [maxColorCount, setMaxColorCount] = useState(4);
  const [targetWidth, setTargetWidth] = useState(60);
  const [levels, setLevels] = useState<LevelDefinition[]>(initialLevelDefinitions);
  const svgHost = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const colors = parsed?.colors.length ? parsed.colors : sampleColors;
  const printColors = useMemo(
    () => [...new Set(colors.map((color) => colorAssignments[color] ?? toHexColor(color)))],
    [colors, colorAssignments],
  );
  const selectedShapes = useMemo(
    () => parsed?.shapes.filter((shape) => selectedIds.includes(shape.id)) ?? [],
    [parsed, selectedIds],
  );
  const levelHeights = useMemo<LevelHeights>(
    () => Object.fromEntries(levels.map((level) => [level.level, level.height])),
    [levels],
  );
  const levelNames = useMemo<Record<number, string>>(
    () => Object.fromEntries(levels.map((level) => [level.level, level.name])),
    [levels],
  );
  const reliefModel = useMemo(() => {
    if (!parsed) return null;
    try { return buildReliefModel(parsed.markup, shapeLevels, levelHeights, targetWidth, levelNames, "preview", colorAssignments); }
    catch { return null; }
  }, [parsed, shapeLevels, levelHeights, targetWidth, levelNames, colorAssignments]);
  const paletteWithinLimit = printColors.length <= maxColorCount;
  const readyToExport = Boolean(reliefModel?.parts.length) && paletteWithinLimit;
  const topology = useMemo(
    () => reliefModel ? inspectReliefTopology(reliefModel) : { irregularEdgeCount: 0, affectedPartCount: 0 },
    [reliefModel],
  );
  const excludedShapeCount = parsed ? parsed.shapes.filter((shape) => (shapeLevels[shape.id] ?? [1]).length === 0).length : 0;
  const skippedShapeCount = parsed && reliefModel ? Math.max(0, parsed.shapes.length - reliefModel.modeledShapeCount - excludedShapeCount) : 0;
  const layerAligned = Object.values(levelHeights).every((height) => Math.abs(height / 0.2 - Math.round(height / 0.2)) < 0.001);

  useEffect(() => {
    const host = svgHost.current;
    if (!host) return;
    host.querySelectorAll<SVGElement>("[data-relief-id]").forEach((element) => {
      const id = element.dataset.reliefId ?? "";
      const sourceColor = element.dataset.reliefFill ?? "#808080";
      element.style.fill = colorAssignments[sourceColor] ?? toHexColor(sourceColor);
      element.classList.toggle("is-selected", selectedIds.includes(id));
      element.dataset.reliefLevel = (shapeLevels[id] ?? [1]).join(",");
    });
  }, [parsed, selectedIds, shapeLevels, viewMode, colorAssignments]);

  useEffect(() => {
    if (!parsed || viewMode !== "2d") return;
    const frame = requestAnimationFrame(() => {
      const svg = svgHost.current?.querySelector<SVGSVGElement>("svg");
      if (!svg) return;
      try {
        const bounds = svg.getBBox();
        if (bounds.width <= 0 || bounds.height <= 0) return;
        const margin = Math.max(bounds.width, bounds.height) * 0.06;
        svg.setAttribute("viewBox", `${bounds.x - margin} ${bounds.y - margin} ${bounds.width + margin * 2} ${bounds.height + margin * 2}`);
      } catch { /* Preserve the source viewBox when measurement is unavailable. */ }
    });
    return () => cancelAnimationFrame(frame);
  });

  async function processSvg(file: File) {
    if (!file.name.toLowerCase().endsWith(".svg")) { setError("Escolha um arquivo SVG para continuar."); return; }
    try {
      const result = parseSvgDocument(await file.text(), file.name);
      const initialLevels = Object.fromEntries(
        result.shapes.map((shape) => [shape.id, [Math.min(result.colors.indexOf(shape.fill), levels.length - 1)]]),
      );
      setParsed(result);
      setShapeLevels(initialLevels);
      setColorAssignments(Object.fromEntries(result.colors.map((color) => [color, toHexColor(color)])));
      setMaxColorCount(Math.max(1, Math.min(4, result.colors.length)));
      setSelectedIds([]);
      setViewMode("2d");
      setActiveStep(1);
      setSourceView(result.layers.length ? "layers" : "colors");
      setError("");
    } catch { setParsed(null); setError("Não foi possível interpretar este SVG. Tente exportá-lo novamente com formas convertidas em contornos."); }
  }

  async function handleSvg(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) await processSvg(file); }
  function handleDownload() {
    if (!reliefModel || !parsed || !readyToExport) return;
    try {
      const exportModel = buildReliefModel(
        parsed.markup,
        shapeLevels,
        levelHeights,
        targetWidth,
        levelNames,
        "export",
        colorAssignments,
      );
      download3mf(exportModel, parsed.name);
      setError("");
    }
    catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Não foi possível preparar este 3MF.");
    }
  }
  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false);
    const file = event.dataTransfer.files?.[0]; if (file) await processSvg(file);
  }

  function selectShape(event: MouseEvent<HTMLDivElement>) {
    const id = (event.target as Element).closest<SVGElement>("[data-relief-id]")?.dataset.reliefId;
    if (!id) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    } else setSelectedIds([id]);
  }

  function selectColor(color: string) {
    if (!parsed) return;
    setSelectedIds(parsed.shapes.filter((shape) => shape.fill === color).map((shape) => shape.id));
    setViewMode("2d");
  }

  function selectLayer(layerId: string) {
    const layer = parsed?.layers.find((item) => item.id === layerId);
    if (!layer) return;
    setSelectedIds(layer.shapeIds); setViewMode("2d");
  }

  function suggestPalette() {
    if (!parsed) return;
    const weights = parsed.colors.map((color) => ({
      color,
      weight: parsed.shapes.filter((shape) => shape.fill === color).length,
    }));
    setColorAssignments(suggestColorAssignments(weights, maxColorCount).assignments);
  }

  function restorePalette() {
    if (!parsed) return;
    setColorAssignments(Object.fromEntries(parsed.colors.map((color) => [color, toHexColor(color)])));
  }

  function assignIds(shapeIds: string[], level: Level) {
    if (!shapeIds.length) return;
    setShapeLevels((current) => {
      const next = { ...current };
      shapeIds.forEach((id) => { next[id] = level === EXCLUDED_LEVEL ? [] : [level]; });
      return next;
    });
  }

  function assignLevel(level: Level) { assignIds(selectedIds, level); }

  function toggleLevel(level: Level) {
    if (!selectedIds.length) return;
    setShapeLevels((current) => {
      const next = { ...current };
      selectedIds.forEach((id) => {
        const assigned = current[id] ?? [1];
        next[id] = assigned.includes(level)
          ? assigned.filter((item) => item !== level)
          : [...assigned, level].sort((a, b) => a - b);
      });
      return next;
    });
  }

  function addRelief() {
    setLevels((current) => {
      if (current.length >= 12) return current;
      const level = current.length;
      return [...current, {
        level,
        name: `Nível ${level}`,
        tone: reliefTones[(level - 1) % reliefTones.length],
        height: 0.2,
      }];
    });
  }

  function updateLevel(level: Level, changes: Partial<LevelDefinition>) {
    setLevels((current) => current.map((item) => item.level === level ? { ...item, ...changes } : item));
  }

  function assignedLevel(shapeIds: string[]) {
    const assignments = shapeIds.map((id) => shapeLevels[id] ?? [1]);
    const signatures = [...new Set(assignments.map((assigned) => assigned.join(",")))];
    if (signatures.length !== 1) return "mixed";
    if (!assignments[0]?.length) return EXCLUDED_LEVEL;
    return assignments[0].length === 1 ? assignments[0][0] : "multiple";
  }

  function selectionLevel(shapeIds: string[]) {
    const assigned = assignedLevel(shapeIds);
    if (assigned === "mixed") return "MISTO";
    if (assigned === "multiple") return "VÁRIOS NÍVEIS";
    if (assigned === EXCLUDED_LEVEL) return "NÃO IMPRIMIR";
    return (levels.find((level) => level.level === assigned)?.name ?? levelLabel(assigned)).toUpperCase();
  }

  function levelCount(level: Level) { return Object.values(shapeLevels).filter((assigned) => assigned.includes(level)).length; }
  function levelSelectionState(level: Level) {
    if (!selectedIds.length) return "none";
    const count = selectedIds.filter((id) => (shapeLevels[id] ?? [1]).includes(level)).length;
    return count === selectedIds.length ? "all" : count > 0 ? "some" : "none";
  }
  function cumulativeHeight(level: Level) {
    return levels.reduce((total, item) => total + (item.level <= level ? item.height : 0), 0);
  }
  function goToStep(step: Step) {
    if (step > 1 && !parsed) return;
    if (step === 4 && !readyToExport) return;
    setActiveStep(step);
    if (step > 1) setViewMode("3d");
  }

  const heading = !parsed
    ? <>Componha por níveis,<br />não por arquivos.</>
    : activeStep === 1 ? "Organize formas e níveis."
      : activeStep === 2 ? "Ajuste as medidas em tempo real."
        : activeStep === 3 ? "Converta as cores para seus filamentos."
          : "Seu projeto está pronto para o slicer.";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>Relief</span><b>LAB</b></div>
        <nav aria-label="Etapas do projeto">
          {([1, 2, 3, 4] as Step[]).map((step) => (
            <button type="button" key={step} className={activeStep === step ? "active" : ""} disabled={(step > 1 && !parsed) || (step === 4 && !readyToExport)} onClick={() => goToStep(step)}>
              <b>{step}</b>{step === 1 ? "Arte" : step === 2 ? "Relevos" : step === 3 ? "Cores" : "Exportar"}
            </button>
          ))}
        </nav>
        <button className="export-button" type="button" disabled={!readyToExport} onClick={handleDownload}>Baixar 3MF</button>
      </header>

      <section className="workspace">
        <aside className="panel source-panel">
          <div className="panel-heading"><div><span className="eyebrow">ENTRADA</span><h2>Arte vetorial</h2></div><span className="step-chip">01</span></div>
          <div className={`drop-zone ${parsed ? "has-file" : ""} ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
            <input ref={fileInput} type="file" accept=".svg,image/svg+xml" onChange={handleSvg} aria-label="Selecionar arquivo SVG" />
            <span className="upload-icon">↑</span>
            <strong>{parsed ? parsed.name : dragging ? "Pode soltar" : "Arraste seu SVG do Finder"}</strong>
            <small>{parsed ? `${parsed.shapes.length} formas · ${parsed.layers.length} grupos` : "ou use a janela temporária do Codex"}</small>
            <button className="file-picker-button" type="button" onClick={() => fileInput.current?.click()}>{parsed ? "Trocar arquivo" : "Escolher SVG compartilhado"}</button>
            {!parsed && <em>Para aparecer na janela, anexe o .svg a esta conversa.</em>}
          </div>
          {error && <p className="error-message">{error}</p>}
          {parsed && <div className="geometry-warning"><span>!</span><p><b>Sobreposições preservadas</b>O recorte booleano não faz parte deste MVP.</p></div>}

          <div className="source-tabs" role="tablist" aria-label="Organizar arte por">
            <button type="button" role="tab" aria-selected={sourceView === "colors"} className={sourceView === "colors" ? "active" : ""} onClick={() => setSourceView("colors")}>Cores <b>{colors.length}</b></button>
            <button type="button" role="tab" aria-selected={sourceView === "layers"} className={sourceView === "layers" ? "active" : ""} onClick={() => setSourceView("layers")} disabled={!parsed}>Grupos <b>{parsed?.layers.length ?? "—"}</b></button>
          </div>
          {sourceView === "colors" ? (
            <div className="color-list">{colors.map((color, index) => {
              const ids = parsed?.shapes.filter((shape) => shape.fill === color).map((shape) => shape.id) ?? [];
              const assignment = assignedLevel(ids);
              return <div className={`color-row ${selectedShapes.some((shape) => shape.fill === color) ? "is-active" : ""}`} key={`${color}-${index}`}>
                <button type="button" className="source-row-main" onClick={() => selectColor(color)} disabled={!parsed}>
                  <i style={{ background: color }} /><span>{parsed ? color.toUpperCase() : ["Base", "Azul", "Turquesa", "Vermelho"][index]}</span><small>{parsed ? `${ids.length} formas` : levelLabel(Math.min(index, 3))}</small>
                </button>
                <select aria-label={`Nível da cor ${color}`} disabled={!parsed} value={assignment} onChange={(event) => assignIds(ids, Number(event.target.value))}>
                  {assignment === "mixed" && <option value="mixed" disabled>Misto</option>}
                  {assignment === "multiple" && <option value="multiple" disabled>Vários níveis</option>}
                  <option value={EXCLUDED_LEVEL}>Não imprimir</option>
                  {levels.map((level) => <option key={level.level} value={level.level}>{level.name}</option>)}
                </select>
              </div>;
            })}</div>
          ) : (
            <div className="layer-list">{parsed?.layers.map((layer) => {
              const assignment = assignedLevel(layer.shapeIds);
              return <div className={`layer-row ${layer.shapeIds.every((id) => selectedIds.includes(id)) ? "is-active" : ""}`} key={layer.id}>
                <button type="button" className="source-row-main" onClick={() => selectLayer(layer.id)}>
                  <span className="layer-icon">▱</span><span className="layer-copy"><strong>{layer.name}</strong><small>{layer.shapeIds.length} formas</small></span>
                  <span className="layer-colors" aria-label={`${layer.colors.length} cores`}>{layer.colors.slice(0, 4).map((color) => <i key={color} style={{ background: color }} />)}{layer.colors.length > 4 && <b>+{layer.colors.length - 4}</b>}</span>
                </button>
                <select aria-label={`Nível do grupo ${layer.name}`} value={assignment} onChange={(event) => assignIds(layer.shapeIds, Number(event.target.value))}>
                  {assignment === "mixed" && <option value="mixed" disabled>Misto</option>}
                  {assignment === "multiple" && <option value="multiple" disabled>Vários níveis</option>}
                  <option value={EXCLUDED_LEVEL}>Não imprimir</option>
                  {levels.map((level) => <option key={level.level} value={level.level}>{level.name}</option>)}
                </select>
              </div>;
            })}</div>
          )}
          <p className="privacy-note"><span>✓</span> O menu define um nível. Para usar vários, selecione o item e marque os níveis à direita.</p>
        </aside>

        <section className="preview-panel">
          <div className="preview-toolbar">
            <div><span className="eyebrow">{activeStep === 4 ? "REVISÃO" : "PRÉ-VISUALIZAÇÃO"}</span><h1>{heading}</h1></div>
            <div className="view-switch" aria-label="Modo de visualização"><button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")} aria-pressed={viewMode === "3d"}>3D</button><button className={viewMode === "2d" ? "active" : ""} onClick={() => setViewMode("2d")} aria-pressed={viewMode === "2d"}>2D</button></div>
          </div>
          <div className={`stage ${viewMode === "2d" ? "mode-2d" : "mode-3d"}`}>
            {viewMode === "2d" && parsed ? <>
              <div className="selection-toolbar"><span>{selectedIds.length ? `${selectedIds.length} forma${selectedIds.length > 1 ? "s" : ""} selecionada${selectedIds.length > 1 ? "s" : ""}` : "Clique em uma forma"}</span>{selectedIds.length > 0 && <button type="button" onClick={() => setSelectedIds([])}>Limpar seleção</button>}</div>
              <div className="svg-artboard" ref={svgHost} role="button" tabIndex={0} aria-label="Arte SVG selecionável; pressione Enter para selecionar tudo" onKeyDown={(event) => { if (event.key === "Escape") setSelectedIds([]); if (event.key === "Enter" || event.key === " ") setSelectedIds(parsed.shapes.map((shape) => shape.id)); }} onClick={selectShape} dangerouslySetInnerHTML={{ __html: parsed.markup }} />
              <div className="stage-hint"><span>⌖</span> Arte centralizada · Shift ou Command seleciona várias formas</div>
            </> : parsed && reliefModel?.parts.length ? <ThreePreview model={reliefModel} /> : <>
              <div className="axis axis-z">Z</div><div className="axis axis-x">X</div><div className="axis axis-y">Y</div>
              <div className="model-stack"><div className="model-layer layer-base"><span>BASE</span></div><div className="model-layer layer-one"><span>NÍVEL 1</span></div><div className="model-layer layer-two"><span>NÍVEL 2</span></div><div className="model-layer layer-three"><span>NÍVEL 3</span></div></div>
              <div className="stage-hint"><span>⌁</span> Carregue um SVG com formas preenchidas para gerar o modelo</div>
            </>}
          </div>
          <div className="status-strip">
            <span><i className="ok" /> {reliefModel ? `${mm(reliefModel.width)} × ${mm(reliefModel.depth)}` : parsed ? `${parsed.shapes.length} formas` : "Alinhamento preservado"}</span>
            <span><i className="ok" /> {reliefModel ? `${printColors.length} cores / ${reliefModel.parts.length} sólidos` : parsed ? `${parsed.colors.length} cores` : "4 materiais"}</span>
            <span><i className={parsed ? "warn" : ""} /> {reliefModel ? `${mm(reliefModel.height)} de altura` : parsed ? "Aguardando geometria" : "2,60 mm de altura"}</span>
          </div>
        </section>

        <aside className="panel levels-panel">
          {activeStep === 1 && <>
            <div className="panel-heading"><div><span className="eyebrow">ESTRUTURA</span><h2>Níveis de relevo</h2></div><button className="add-button" type="button" onClick={addRelief} disabled={levels.length >= 12} aria-label="Adicionar relevo">+</button></div>
            <div className="assignment-guide"><span>1</span><p><b>Escolha uma cor ou grupo</b>Use a lista ou selecione diretamente na arte.</p><span>2</span><p><b>Marque um ou mais níveis</b>Clique nos níveis abaixo para adicionar ou retirar a seleção.</p></div>
            <div className={`selection-summary ${selectedIds.length ? "has-selection" : ""}`}><span>{selectedIds.length || "—"}</span><div><small>SELEÇÃO ATUAL</small><strong>{selectedIds.length ? `${selectionLevel(selectedIds)} · marque os níveis` : "Selecione uma cor, grupo ou forma"}</strong></div></div>
            <button className="exclude-action" type="button" disabled={!selectedIds.length} onClick={() => assignLevel(EXCLUDED_LEVEL)}><span>×</span><div><strong>Não imprimir</strong><small>Retira a seleção do modelo 3D e do 3MF</small></div></button>
            <div className="level-timeline">{[...levels].reverse().map(({ level, name, tone }) => {
              const state = levelSelectionState(level);
              return <button className={`level-card ${state === "all" ? "is-assigned" : state === "some" ? "is-partial" : ""}`} key={level} type="button" disabled={!selectedIds.length} aria-pressed={state === "all"} onClick={() => toggleLevel(level)}><span className={`level-dot ${tone}`} /><span className="assignment-state">{state === "all" ? "✓" : state === "some" ? "−" : "+"}</span><div><small>{level === 0 ? "FUNDAÇÃO" : `RELEVO ${String(level).padStart(2, "0")}`}</small><strong>{name}</strong></div><div className="height"><b>{mm(levelHeights[level])}</b><small>{levelCount(level)} formas</small></div></button>;
            })}</div>
            <div className="manufacture-card"><span className="eyebrow">PERFIL DE IMPRESSÃO</span><div><span>Bico</span><b>0,4 mm</b></div><div><span>Camada</span><b>0,20 mm</b></div><div><span>Slicer</span><b>Bambu / Orca</b></div></div>
            <button className="primary-action" type="button" disabled={!parsed} onClick={() => goToStep(2)}>Continuar para medidas <span>→</span></button>
          </>}

          {activeStep === 2 && <>
            <div className="panel-heading"><div><span className="eyebrow">GEOMETRIA</span><h2>Medidas do modelo</h2></div><span className="step-chip">02</span></div>
            <div className="dimension-card"><label><span>Largura final</span><div><input type="number" min="10" max="300" step="1" value={targetWidth} onChange={(event) => setTargetWidth(Math.max(10, Number(event.target.value) || 10))} /><b>mm</b></div></label><small>A outra dimensão acompanha a proporção do SVG.</small></div>
            <div className="height-settings">{levels.map(({ level, name, tone, height }) => <div className="height-setting" key={level}><span className={`level-dot ${tone}`} /><span><input className="level-name-input" aria-label={`Nome do nível ${level}`} value={name} onChange={(event) => updateLevel(level, { name: event.target.value })} /><small>Topo em {mm(cumulativeHeight(level))}</small></span><div><input aria-label={`${name} em milímetros`} type="number" min="0.2" max="10" step="0.2" value={height} onChange={(event) => updateLevel(level, { height: Math.max(0.2, Number(event.target.value) || 0.2) })} /><b>mm</b></div></div>)}</div>
            <div className={`validation-card ${layerAligned ? "valid" : "warning"}`}><span>{layerAligned ? "✓" : "!"}</span><p><b>{layerAligned ? "Alturas compatíveis" : "Revise as alturas"}</b>{layerAligned ? "Todos os valores respeitam camadas de 0,20 mm." : "Use múltiplos de 0,20 mm para o perfil atual."}</p></div>
            <div className="secondary-actions"><button type="button" onClick={() => goToStep(1)}>← Arte</button><button type="button" disabled={!reliefModel?.parts.length} onClick={() => goToStep(3)}>Cores →</button></div>
          </>}

          {activeStep === 3 && <>
            <div className="panel-heading"><div><span className="eyebrow">MATERIAIS</span><h2>Cores de impressão</h2></div><span className="step-chip">03</span></div>
            <p className="color-stage-intro">Associe cada cor original à cor do filamento que será usada na impressão.</p>
            <div className={`palette-card palette-stage-card ${paletteWithinLimit ? "" : "over-limit"}`}>
              <div className="palette-heading"><div><span>PALETA FINAL</span><strong>{printColors.length} de {maxColorCount} cores</strong></div><label>Máximo<select aria-label="Quantidade máxima de cores" value={maxColorCount} onChange={(event) => setMaxColorCount(Number(event.target.value))}>{Array.from({ length: Math.min(8, colors.length) }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}</select></label></div>
              <div className="palette-swatches" aria-label="Cores atuais de impressão">{printColors.map((color) => <i key={color} style={{ background: color }} title={color.toUpperCase()} />)}</div>
              <p>{paletteWithinLimit ? "A paleta está dentro do limite escolhido." : "A paleta excede o limite. Aplique uma sugestão ou ajuste manualmente."}</p>
              <div className="palette-actions"><button type="button" onClick={suggestPalette}>Sugerir atribuição</button><button type="button" onClick={restorePalette}>Restaurar</button></div>
              <small>A sugestão prioriza cores frequentes e aproxima tons semelhantes.</small>
            </div>
            <div className="color-mapping-heading"><span>COR ORIGINAL</span><span>COR DO FILAMENTO</span></div>
            <div className="color-mapping-list">{colors.map((color) => {
              const printColor = colorAssignments[color] ?? toHexColor(color);
              return <div className="color-mapping-row" key={color}>
                <div className="mapping-color source"><i style={{ background: color }} /><span><strong>{colorLabel(color)}</strong><small>{toHexColor(color).toUpperCase()}</small></span></div>
                <span className="mapping-arrow">→</span>
                <label className="mapping-color target" title="Clique para escolher a cor do filamento"><i style={{ background: printColor }} /><span><strong>{colorLabel(printColor)}</strong><small>{printColor.toUpperCase()}</small></span><input type="color" aria-label={`Cor do filamento para ${colorLabel(color)}`} value={printColor} onChange={(event) => setColorAssignments((current) => ({ ...current, [color]: event.target.value }))} /></label>
              </div>;
            })}</div>
            <div className={`validation-card ${paletteWithinLimit ? "valid" : "warning"}`}><span>{paletteWithinLimit ? "✓" : "!"}</span><p><b>{paletteWithinLimit ? "Paleta pronta" : "Cores acima do limite"}</b>{paletteWithinLimit ? `${printColors.length} cor${printColors.length > 1 ? "es serão" : " será"} exportada${printColors.length > 1 ? "s" : ""} como materiais.` : `Reduza de ${printColors.length} para no máximo ${maxColorCount} cores.`}</p></div>
            <div className="secondary-actions"><button type="button" onClick={() => goToStep(2)}>← Relevos</button><button type="button" disabled={!readyToExport} onClick={() => goToStep(4)}>Exportar →</button></div>
          </>}

          {activeStep === 4 && <>
            <div className="panel-heading"><div><span className="eyebrow">SAÍDA</span><h2>Exportar projeto</h2></div><span className="step-chip">04</span></div>
            <div className="export-summary"><span className="export-cube">⬡</span><strong>{parsed?.name.replace(/\.svg$/i, "")}</strong><small>3MF multissólido em milímetros</small><dl><div><dt>Dimensões</dt><dd>{reliefModel ? `${mm(reliefModel.width)} × ${mm(reliefModel.depth)}` : "—"}</dd></div><div><dt>Altura</dt><dd>{reliefModel ? mm(reliefModel.height) : "—"}</dd></div><div><dt>Sólidos</dt><dd>{reliefModel?.parts.length ?? 0}</dd></div><div><dt>Triângulos</dt><dd>{reliefModel?.triangleCount.toLocaleString("pt-BR") ?? 0}</dd></div></dl></div>
            <div className="export-checks"><p><span>✓</span> Alinhamento preservado</p><p><span>✓</span> Curvas em alta resolução</p><p><span>✓</span> Unidade em milímetros</p><p><span>✓</span> Cores como materiais</p>{excludedShapeCount > 0 && <p><span>✓</span> {excludedShapeCount} forma{excludedShapeCount > 1 ? "s" : ""} retirada{excludedShapeCount > 1 ? "s" : ""} do modelo</p>}{topology.affectedPartCount > 0 && <p className="warning"><span>!</span> {topology.affectedPartCount} sólido{topology.affectedPartCount > 1 ? "s têm" : " tem"} bordas que o slicer tentará reparar</p>}<p className="warning"><span>!</span> Sobreposições preservadas</p>{skippedShapeCount > 0 && <p className="warning"><span>!</span> {skippedShapeCount} forma{skippedShapeCount > 1 ? "s" : ""} sem preenchimento não foi{skippedShapeCount > 1 ? "ram" : ""} extrudada{skippedShapeCount > 1 ? "s" : ""}</p>}</div>
            <button className="download-action" type="button" disabled={!readyToExport} onClick={handleDownload}>Baixar arquivo 3MF <span>↓</span></button>
            <button className="back-action" type="button" onClick={() => goToStep(3)}>← Voltar às cores</button>
          </>}
        </aside>
      </section>
    </main>
  );
}
