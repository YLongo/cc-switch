import React, { useRef, useEffect, useMemo } from "react";
import { EditorView, basicSetup } from "codemirror";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState, Compartment } from "@codemirror/state";
import { placeholder } from "@codemirror/view";
import { linter, Diagnostic } from "@codemirror/lint";
import { useTranslation } from "react-i18next";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { formatJSON } from "@/utils/formatters";

interface JsonEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  darkMode?: boolean;
  rows?: number;
  showValidation?: boolean;
  language?: "json" | "javascript";
  height?: string | number;
  showMinimap?: boolean;
}

const JsonEditor = React.memo<JsonEditorProps>(({
  value,
  onChange,
  placeholder: placeholderText = "",
  darkMode = false,
  rows = 12,
  showValidation = true,
  language = "json",
  height,
}) => {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());

  // JSON linter 函数
  const jsonLinter = useMemo(
    () =>
      linter((view) => {
        const diagnostics: Diagnostic[] = [];
        if (!showValidation || language !== "json") return diagnostics;

        const doc = view.state.doc.toString();
        if (!doc.trim()) return diagnostics;

        try {
          const parsed = JSON.parse(doc);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            // 格式正确
          } else {
            diagnostics.push({
              from: 0,
              to: doc.length,
              severity: "error",
              message: t("jsonEditor.mustBeObject"),
            });
          }
        } catch (e) {
          const message =
            e instanceof SyntaxError ? e.message : t("jsonEditor.invalidJson");
          diagnostics.push({
            from: 0,
            to: doc.length,
            severity: "error",
            message,
          });
        }

        return diagnostics;
      }),
    [showValidation, language, t],
  );

  // 动态主题扩展（稳定引用，避免重建编辑器）
  const darkThemeExtensions = useMemo(
    () => [
      oneDark,
      EditorView.theme({
        ".cm-editor": {
          border: "1px solid hsl(var(--border))",
          borderRadius: "0.5rem",
          background: "transparent",
        },
        ".cm-editor.cm-focused": {
          outline: "none",
          borderColor: "hsl(var(--primary))",
        },
        ".cm-scroller": {
          background: "transparent",
        },
        ".cm-gutters": {
          background: "transparent",
          borderRight: "1px solid hsl(var(--border))",
          color: "hsl(var(--muted-foreground))",
        },
        ".cm-selectionBackground, .cm-content ::selection": {
          background: "hsl(var(--primary) / 0.18)",
        },
        ".cm-selectionMatch": {
          background: "hsl(var(--primary) / 0.12)",
        },
        ".cm-activeLine": {
          background: "hsl(var(--primary) / 0.08)",
        },
        ".cm-activeLineGutter": {
          background: "hsl(var(--primary) / 0.08)",
        },
      }),
    ],
    [],
  );

  // 创建编辑器（仅挂载时创建，不依赖 darkMode）
  useEffect(() => {
    if (!editorRef.current) return;

    const minHeightPx = height ? undefined : Math.max(1, rows) * 18;

    const baseTheme = EditorView.baseTheme({
      ".cm-editor": {
        border: "1px solid hsl(var(--border))",
        borderRadius: "0.5rem",
        background: "transparent",
      },
      ".cm-editor.cm-focused": {
        outline: "none",
        borderColor: "hsl(var(--primary))",
      },
      ".cm-scroller": {
        background: "transparent",
      },
      ".cm-gutters": {
        background: "transparent",
        borderRight: "1px solid hsl(var(--border))",
        color: "hsl(var(--muted-foreground))",
      },
      ".cm-selectionBackground, .cm-content ::selection": {
        background: "hsl(var(--primary) / 0.18)",
      },
      ".cm-selectionMatch": {
        background: "hsl(var(--primary) / 0.12)",
      },
      ".cm-activeLine": {
        background: "hsl(var(--primary) / 0.08)",
      },
      ".cm-activeLineGutter": {
        background: "hsl(var(--primary) / 0.08)",
      },
    });

    const heightValue = height
      ? typeof height === "number"
        ? `${height}px`
        : height
      : undefined;
    const sizingTheme = EditorView.theme({
      "&": heightValue
        ? { height: heightValue }
        : { minHeight: `${minHeightPx}px` },
      ".cm-scroller": { overflow: "auto" },
      ".cm-content": {
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: "14px",
      },
    });

    const extensions = [
      basicSetup,
      language === "javascript" ? javascript() : json(),
      placeholder(placeholderText || ""),
      baseTheme,
      sizingTheme,
      jsonLinter,
      themeCompartmentRef.current.of([]), // 初始无主题，由下方单独 effect 控制
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newValue = update.state.doc.toString();
          onChange(newValue);
        }
      }),
    ];

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 注意：onChange 不在此依赖中，编辑器重建时使用首次创建的闭包引用。
    // React Hook Form 的 setValue 不依赖闭包，因此始终能正确上报。
  }, [rows, height, language, jsonLinter]);

  // 动态切换暗色主题，不重建编辑器
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: themeCompartmentRef.current.reconfigure(
          darkMode ? darkThemeExtensions : [],
        ),
      });
    }
  }, [darkMode, darkThemeExtensions]);

  // 当 value 从外部改变时更新编辑器内容
  useEffect(() => {
    if (viewRef.current && viewRef.current.state.doc.toString() !== value) {
      const transaction = viewRef.current.state.update({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: value,
        },
      });
      viewRef.current.dispatch(transaction);
    }
  }, [value]);

  const handleFormat = () => {
    if (!viewRef.current) return;

    const currentValue = viewRef.current.state.doc.toString();
    if (!currentValue.trim()) return;

    try {
      const formatted = formatJSON(currentValue);
      onChange(formatted);
      toast.success(t("common.formatSuccess", { defaultValue: "格式化成功" }), {
        closeButton: true,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(
        t("common.formatError", {
          defaultValue: "格式化失败：{{error}}",
          error: errorMessage,
        }),
      );
    }
  };

  const isFullHeight = height === "100%";

  return (
    <div
      style={{ width: "100%", height: isFullHeight ? "100%" : "auto" }}
      className={isFullHeight ? "flex flex-col" : ""}
    >
      <div
        ref={editorRef}
        style={{ width: "100%", height: isFullHeight ? undefined : "auto" }}
        className={isFullHeight ? "flex-1 min-h-0" : ""}
      />
      {language === "json" && (
        <button
          type="button"
          onClick={handleFormat}
          className={`${isFullHeight ? "mt-2 flex-shrink-0" : "mt-2"} inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors`}
        >
          <Wand2 className="w-3.5 h-3.5" />
          {t("common.format", { defaultValue: "格式化" })}
        </button>
      )}
    </div>
  );
});

export default JsonEditor;
