import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

interface Option {
  id: number | string;
  label: string;
  subLabel?: string;
  image?: string;
  typeIcon?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: number | string | null;
  onChange: (value: number | string | null) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

export default function SearchableSelect({ options, value, onChange, placeholder, style }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(() => options.find(o => o.id === value), [options, value]);

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const lowerSearch = search.toLowerCase();
    return options.filter(o => 
      o.label.toLowerCase().includes(lowerSearch) || 
      (o.subLabel && o.subLabel.toLowerCase().includes(lowerSearch))
    );
  }, [options, search]);

  const updateCoords = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      // Use capture to catch scrolls in parents (like modals)
      window.addEventListener('scroll', updateCoords, true);
      window.addEventListener('resize', updateCoords);
    }
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        // Also check if click was on the portal
        const portal = document.getElementById('searchable-select-portal');
        if (portal && portal.contains(event.target as Node)) return;
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (id: number | string | null) => {
    onChange(id);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', ...style }}>
      <div 
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setTimeout(() => inputRef.current?.focus(), 0);
        }}
        style={{
          padding: '0.6rem',
          borderRadius: 8,
          border: '1px solid #333',
          background: '#0a0a0a',
          color: value ? '#fff' : 'var(--text-muted)',
          fontSize: '0.875rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minHeight: '38px'
        }}
      >
        {selectedOption ? (
          <>
            {selectedOption.image && <img src={selectedOption.image} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain' }} />}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedOption.subLabel && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginRight: 4 }}>[{selectedOption.subLabel}]</span>}
                {selectedOption.label}
            </span>
          </>
        ) : (
          <span>{placeholder || 'Select...'}</span>
        )}
      </div>

      {isOpen && createPortal(
        <div 
          id="searchable-select-portal"
          style={{
            position: 'absolute',
            top: coords.top + 4,
            left: coords.left,
            width: coords.width,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 8,
            zIndex: 9999,
            maxHeight: '300px',
            overflowY: 'auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.7)'
          }}
        >
          <div style={{ position: 'sticky', top: 0, background: '#1a1a1a', padding: '8px', borderBottom: '1px solid #333' }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              onMouseDown={e => e.stopPropagation()} // Prevent closing on click
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 4,
                border: '1px solid #444',
                background: '#0a0a0a',
                color: '#fff',
                fontSize: '0.875rem'
              }}
            />
          </div>
          <div style={{ padding: '4px' }}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map(opt => (
                <div
                  key={opt.id}
                  onClick={() => handleSelect(opt.id)}
                  style={{
                    padding: '8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    background: value === opt.id ? '#2563eb33' : 'transparent',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#333'}
                  onMouseLeave={e => e.currentTarget.style.background = value === opt.id ? '#2563eb33' : 'transparent'}
                >
                  {opt.image && <img src={opt.image} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'contain' }} />}
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <span style={{ fontSize: '0.875rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {opt.label}
                    </span>
                    {opt.subLabel && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{opt.subLabel}</span>
                    )}
                  </div>
                  {opt.typeIcon && (
                      <img src={opt.typeIcon} alt="" style={{ marginLeft: 'auto', width: 16, height: 16, objectFit: 'contain' }} />
                  )}
                </div>
              ))
            ) : (
              <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No results found
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
