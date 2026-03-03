import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface AssistantMarkdownProps {
  content: string;
  className?: string;
}

export default function AssistantMarkdown({ content, className }: AssistantMarkdownProps) {
  return (
    <div className={cn("ai-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node: _node, ...props }) => <h1 {...props} />,
          h2: ({ node: _node, ...props }) => <h2 {...props} />,
          h3: ({ node: _node, ...props }) => <h3 {...props} />,
          p: ({ node: _node, ...props }) => <p {...props} />,
          ul: ({ node: _node, ...props }) => <ul {...props} />,
          ol: ({ node: _node, ...props }) => <ol {...props} />,
          li: ({ node: _node, ...props }) => <li {...props} />,
          strong: ({ node: _node, ...props }) => <strong {...props} />,
          em: ({ node: _node, ...props }) => <em {...props} />,
          blockquote: ({ node: _node, ...props }) => <blockquote {...props} />,
          hr: ({ node: _node, ...props }) => <hr {...props} />,
          a: ({ node: _node, ...props }) => <a {...props} />,
          table: ({ node: _node, ...props }) => (
            <div className="ai-markdown-table-wrap">
              <table {...props} />
            </div>
          ),
          code: ({ node: _node, className: codeClassName, children, ...props }) => {
            const value = String(children ?? "");
            const isCodeBlock =
              (typeof codeClassName === "string" && codeClassName.includes("language-")) || value.includes("\n");
            return (
              <code className={cn(!isCodeBlock && "ai-markdown-inline-code", codeClassName)} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ node: _node, ...props }) => <pre {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
