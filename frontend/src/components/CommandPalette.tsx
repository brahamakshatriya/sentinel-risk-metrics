'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import { usePortfolios, useCreatePortfolio } from '@/hooks/useApi';
import { useRouter } from 'next/navigation';

interface CommandItem {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  action: () => void;
  category: string;
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { data: portfolios } = usePortfolios();
  const createPortfolio = useCreatePortfolio();

  const buildCommands = useCallback((): CommandItem[] => {
    const commands: CommandItem[] = [
      {
        id: 'new-portfolio',
        label: 'Create New Portfolio',
        description: 'Create a new portfolio',
        shortcut: 'N',
        category: 'Portfolio',
        action: () => {
          const name = prompt('Portfolio name:');
          if (name) {
            createPortfolio.mutate({ name });
          }
        },
      },
      {
        id: 'refresh-data',
        label: 'Refresh All Data',
        description: 'Refetch all portfolio data',
        shortcut: 'R',
        category: 'Data',
        action: () => window.location.reload(),
      },
    ];

    if (portfolios) {
      portfolios.forEach((p) => {
        commands.push({
          id: `portfolio-${p.id}`,
          label: p.name,
          description: `Portfolio ID: ${p.id} • ${p.holdings?.length || 0} holdings`,
          category: 'Portfolios',
          action: () => router.push(`/portfolios/${p.id}`),
        });
      });
    }

    return commands;
  }, [portfolios, router, createPortfolio]);

  const filteredCommands = buildCommands().filter((cmd) =>
    cmd.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cmd.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cmd.shortcut?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
          close();
        }
        break;
      case 'Escape':
        close();
        break;
    }
  };

  const open = () => {
    setIsOpen(true);
    setSelectedIndex(0);
    setSearchQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const close = () => {
    setIsOpen(false);
    setSearchQuery('');
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (!isOpen) open();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={close} />
      <Card className="w-full max-w-2xl shadow-xl animate-in slide-in-from-top-2 duration-200">
        <div className="p-4">
          <div className="relative">
            <svg 
              className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input
              ref={inputRef}
              placeholder="Type a command or search..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              className="pl-10 text-lg"
              autoFocus
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground px-2 py-1 bg-muted rounded">
              ⌘K
            </kbd>
          </div>

          {filteredCommands.length > 0 ? (
            <div className="mt-2 max-h-96 overflow-y-auto">
              {filteredCommands.map((cmd, index) => (
                <button
                  key={cmd.id}
                  onClick={() => {
                    cmd.action();
                    close();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    'w-full px-3 py-3 rounded-lg text-left transition-colors flex items-center justify-between gap-3',
                    index === selectedIndex
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <div className="flex-1">
                    <div className="font-medium">{cmd.label}</div>
                    <div className="text-sm text-muted-foreground">{cmd.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground uppercase">{cmd.category}</span>
                    {cmd.shortcut && (
                      <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded text-muted-foreground">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 p-6 text-center text-muted-foreground">
              No commands found
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}