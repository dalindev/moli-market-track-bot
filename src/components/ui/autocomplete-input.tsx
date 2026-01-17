'use client';

import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { useItemsSearch } from '@/hooks/useItemsSearch';
import { cn } from '@/lib/utils';

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (itemName: string) => void;
  onEnter?: () => void; // Called when Enter is pressed with no item selected
  placeholder?: string;
  className?: string;
}

export function AutocompleteInput({
  value,
  onChange,
  onSelect,
  onEnter,
  placeholder = 'Search items...',
  className,
}: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: suggestions = [], isLoading } = useItemsSearch(value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Open dropdown when we have suggestions
  useEffect(() => {
    if (suggestions.length > 0 && value.length >= 2) {
      setIsOpen(true);
    }
  }, [suggestions, value]);

  const handleSelect = (itemName: string) => {
    onChange(itemName);
    onSelect?.(itemName);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        if (!isOpen || suggestions.length === 0) return;
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        if (!isOpen || suggestions.length === 0) return;
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (isOpen && highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          handleSelect(suggestions[highlightedIndex].name);
        } else {
          // No item highlighted - trigger search
          setIsOpen(false);
          onEnter?.();
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlightedIndex(-1);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full"
      />

      {/* Dropdown */}
      {isOpen && (suggestions.length > 0 || isLoading) && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
          {isLoading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Searching...
            </div>
          ) : (
            suggestions.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'w-full px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent transition-colors',
                  highlightedIndex === index && 'bg-accent'
                )}
                onClick={() => handleSelect(item.name)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className="font-medium">{item.name}</span>
                {item.item_type === 'pet' && (
                  <span className="ml-2 text-xs text-purple-500">Pet</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
