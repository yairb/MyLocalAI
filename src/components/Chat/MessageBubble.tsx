import { useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy, User } from 'lucide-react'
import type { Message } from '@/types'
import { cn } from '@/utils/cn'
import { TypingIndicator } from '@/components/UI/Spinner'

interface MessageBubbleProps {
  message?: Message
  streaming?: string
  isStreaming?: boolean
}

function CodeBlock({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const language = /language-(\w+)/.exec(className || '')?.[1] ?? 'code'
  const code = String(children).replace(/\n$/, '')

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-border bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-border-subtle bg-[#141414] px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-dim">
          {language}
        </span>
        <button
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted transition hover:bg-card hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="!m-0 !border-0 !bg-transparent !p-0">
        <code className={cn('block overflow-x-auto p-4 text-[13px]', className)}>
          {children}
        </code>
      </pre>
    </div>
  )
}

export function MessageBubble({
  message,
  streaming,
  isStreaming,
}: MessageBubbleProps) {
  const role = message?.role ?? 'assistant'
  const content = streaming ?? message?.content ?? ''
  const isUser = role === 'user'

  const markdown = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className?.includes('language-')) ||
              String(children).includes('\n')
            if (isBlock) {
              return <CodeBlock className={className}>{children}</CodeBlock>
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    ),
    [content],
  )

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="flex max-w-[85%] items-start gap-3 sm:max-w-[75%]">
          <div className="rounded-2xl rounded-br-md bg-user-bubble px-4 py-3 text-[15px] leading-relaxed text-white shadow-sm">
            <p className="whitespace-pre-wrap">{content}</p>
          </div>
          <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card border border-border">
            <User className="h-4 w-4 text-muted" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="flex max-w-[90%] items-start gap-3 sm:max-w-[80%]">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft border border-accent/20">
          <div className="h-2.5 w-2.5 rounded-full bg-accent" />
        </div>
        <div className="min-w-0 flex-1 pt-1">
          {isStreaming && !content ? (
            <TypingIndicator />
          ) : (
            <div className="prose-chat">
              {markdown}
              {isStreaming && (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
