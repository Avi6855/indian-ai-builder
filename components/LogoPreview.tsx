"use client";

import { useState } from "react";
import { X } from "lucide-react";

export function LogoPreview({ className }: { className?: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(true);
        }}
        className={`cursor-pointer shrink-0 ${className || "h-8 w-8"}`}
      >
        <img
          src="/IndianAI_Builder_Logo.png"
          alt="INDIAN AI BUILDER Logo"
          className="w-full h-full object-contain rounded-md hover:opacity-80 transition-opacity"
        />
      </div>

      {isOpen && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(false);
          }}
        >
          <button 
            className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen(false);
            }}
          >
            <X className="w-6 h-6" />
          </button>
          
          <div 
            className="relative w-[80vw] h-[80vh] max-w-4xl animate-in zoom-in-95 duration-200 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src="/IndianAI_Builder_Logo.png"
              alt="INDIAN AI BUILDER Logo Fullscreen"
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
