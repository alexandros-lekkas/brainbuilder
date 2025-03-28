import { Handle, Position, NodeProps } from "@xyflow/react";
import { useRef, useState, useEffect } from "react";
import {
  ArrowLeftRight,
  Sparkles,
  Loader2,
  Wand2,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils/tailwind";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/use-auth";

import { Textarea } from "@/components/ui/textarea";
import { SelectStatesDialog } from "./select-states-dialog";
import { BuildConditionalDialog } from "./build-conditional-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type NodeType = "analysis" | "conditional" | "prompt";

interface CustomInfo {
  id: string;
  name: string;
}

export interface BaseNodeData {
  label: string;
  type: NodeType;
  onLabelChange?: (nodeId: string, newLabel: string) => void;
}

export interface AnalysisNodeData extends BaseNodeData {
  type: "analysis";
  childId?: string;
  selectedStates: string[];
  onStatesChange?: (nodeId: string, stateIds: string[]) => void;
  graphId: string;
  prompt?: string;
  onPromptChange?: (nodeId: string, newData: AnalysisNodeData) => void;
}

export interface ConditionalNodeData extends BaseNodeData {
  type: "conditional";
  trueChildId?: string;
  falseChildId?: string;
  conditions?: {
    stateId: string;
    operator:
      | "equals"
      | "notEquals"
      | "greaterThan"
      | "lessThan"
      | "contains"
      | "notContains";
    value: string;
  }[];
  operator?: "and" | "or";
  onConditionalChange?: (nodeId: string, data: ConditionalNodeData) => void;
  graphId: string;
}

export interface PromptNodeData extends BaseNodeData {
  type: "prompt";
  prompt?: string;
  graphId: string;
  onPromptChange?: (nodeId: string, newData: PromptNodeData) => void;
}

export type CustomNodeData =
  | AnalysisNodeData
  | ConditionalNodeData
  | PromptNodeData;

export interface CustomNode {
  id: string;
  position: { x: number; y: number };
  data: CustomNodeData;
  type: NodeType;
}

function NodeTypeLabel({ type }: { type: NodeType }) {
  return (
    <div className="absolute -top-5 left-0 right-0 text-[10px] text-gray-400 text-center uppercase tracking-wider">
      {type}
    </div>
  );
}

const baseNodeStyles =
  "p-3 px-4 shadow-sm rounded-lg border backdrop-blur-[4px] bg-white/5";

export function AnalysisNode({
  data,
  isConnectable,
  selected,
  id,
}: NodeProps & { data: CustomNodeData; selected?: boolean }) {
  const labelRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(200);
  const [isSelectingStates, setIsSelectingStates] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isCustomPromptOpen, setIsCustomPromptOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const { user } = useAuth();

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value;
    data.onLabelChange?.(id, newLabel);
    if (labelRef.current) {
      const tempSpan = document.createElement("span");
      tempSpan.style.visibility = "hidden";
      tempSpan.style.position = "absolute";
      tempSpan.style.whiteSpace = "pre";
      tempSpan.style.font = window.getComputedStyle(labelRef.current).font;
      tempSpan.textContent = newLabel;
      document.body.appendChild(tempSpan);
      const newWidth = Math.max(200, tempSpan.offsetWidth + 140);
      document.body.removeChild(tempSpan);
      setWidth(newWidth);
    }
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newData = {
      ...data,
      prompt: e.target.value,
    };
    (data as AnalysisNodeData).onPromptChange?.(
      id,
      newData as AnalysisNodeData
    );
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    e.stopPropagation();
  };

  const analysisData = data as AnalysisNodeData;
  const selectedStatesCount = analysisData.selectedStates?.length || 0;

  const handleStatesChange = (stateIds: string[]) => {
    analysisData.onStatesChange?.(id, stateIds);
  };

  const handleGeneratePrompt = async (prompt: string) => {
    if (!user?.openai_api_key) {
      toast.error(
        "Please set your OpenAI API key in settings to use AI features"
      );
      return;
    }

    setIsGeneratingPrompt(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("No access token");
      }

      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          prompt,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate prompt");
      }

      const { response: generatedPrompt } = await response.json();
      const newData = {
        ...data,
        prompt: generatedPrompt,
      };
      (data as AnalysisNodeData).onPromptChange?.(
        id,
        newData as AnalysisNodeData
      );
    } catch (error) {
      console.error("Error generating prompt:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to generate prompt"
      );
    } finally {
      setIsGeneratingPrompt(false);
      setIsCustomPromptOpen(false);
      setCustomPrompt("");
    }
  };

  return (
    <div className="relative">
      <NodeTypeLabel type={data.type} />
      <div
        className={cn(
          baseNodeStyles,
          "border-blue-500/20",
          selected && "border-2 border-blue-400/50"
        )}
        style={{ width: `${width}px` }}
      >
        <input
          ref={labelRef}
          type="text"
          value={data.label}
          onChange={handleLabelChange}
          onKeyDown={handleKeyDown}
          className="w-full text-sm text-center bg-transparent border-none focus:outline-none focus:ring-0 p-0"
          aria-label="Node label"
        />

        <div className="flex items-center justify-center gap-2 mt-2 text-sm">
          <Button
            onClick={() => setIsSelectingStates(true)}
            variant="outline"
            size="sm"
          >
            <ArrowLeftRight className="h-4 w-4" />
            States: {selectedStatesCount} selected
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={isGeneratingPrompt}
              >
                {isGeneratingPrompt ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  handleGeneratePrompt(
                    `Write brief, direct instructions for roleplaying: "${data.prompt}". No professional advice - just raw emotional expression. Keep it under 3 sentences. Example for "angry at therapist": Glare intensely. Use short, snappy responses. Cross arms and lean back defensively.`
                  )
                }
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Fix & Improve
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  handleGeneratePrompt(
                    `Write 1-2 sentences max for roleplaying: "${data.prompt}". Focus only on the key actions and reactions needed to show this emotional state. No professional advice.`
                  )
                }
              >
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Make Shorter
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  handleGeneratePrompt(
                    `Write detailed roleplay instructions for: "${data.prompt}". Include specific verbal responses, tone variations, gestures, expressions, and thought patterns. No professional advice - focus on raw emotional expression and method acting this state.`
                  )
                }
              >
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Make Longer
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsCustomPromptOpen(true)}>
                <MessageSquare className="h-4 w-4 mr-2" />
                Custom Prompt
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Textarea
          value={analysisData.prompt ?? ""}
          onChange={handlePromptChange}
          onKeyDown={handleKeyDown}
          placeholder="Enter your analysis prompt here..."
          className="w-full text-sm bg-transparent min-h-[100px] mt-2"
        />

        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={isConnectable}
          className="!bg-blue-400 !w-3 !h-3 !border-2 !border-background"
        />
      </div>

      <SelectStatesDialog
        open={isSelectingStates}
        onOpenChange={setIsSelectingStates}
        graphId={analysisData.graphId}
        selectedStateIds={analysisData.selectedStates || []}
        onStatesChange={handleStatesChange}
      />

      <Dialog open={isCustomPromptOpen} onOpenChange={setIsCustomPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Custom AI Prompt</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Tell the AI what you want to change or improve..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCustomPromptOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                handleGeneratePrompt(
                  `For a node labeled "${data.label}", ${customPrompt}`
                )
              }
              disabled={!customPrompt.trim()}
            >
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ConditionalNode({
  data,
  isConnectable,
  selected,
  id,
}: NodeProps & { data: CustomNodeData; selected?: boolean }) {
  const labelRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(200);
  const [isBuildingConditional, setIsBuildingConditional] = useState(false);

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value;
    data.onLabelChange?.(id, newLabel);
    if (labelRef.current) {
      const tempSpan = document.createElement("span");
      tempSpan.style.visibility = "hidden";
      tempSpan.style.position = "absolute";
      tempSpan.style.whiteSpace = "pre";
      tempSpan.style.font = window.getComputedStyle(labelRef.current).font;
      tempSpan.textContent = newLabel;
      document.body.appendChild(tempSpan);
      const newWidth = Math.max(200, tempSpan.offsetWidth + 40);
      document.body.removeChild(tempSpan);
      setWidth(newWidth);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
  };

  const conditionalData = data as ConditionalNodeData;
  const conditionsCount = conditionalData.conditions?.length || 0;

  const handleConditionalChange = (newData: ConditionalNodeData) => {
    conditionalData.onConditionalChange?.(id, newData);
  };

  return (
    <div className="relative">
      <NodeTypeLabel type={data.type} />
      <div
        className={cn(
          baseNodeStyles,
          "border-yellow-500/20",
          selected && "border-2 border-yellow-400/50"
        )}
        style={{ width: `${width}px` }}
      >
        <Handle
          type="target"
          position={Position.Top}
          isConnectable={isConnectable}
          className="!bg-yellow-400 !w-3 !h-3 !border-2 !border-background"
        />

        <input
          ref={labelRef}
          type="text"
          value={data.label}
          onChange={handleLabelChange}
          onKeyDown={handleKeyDown}
          className="w-full text-sm text-center bg-transparent border-none focus:outline-none focus:ring-0 p-0"
          aria-label="Node label"
        />

        <div className="flex items-center justify-center gap-2 mt-2 text-sm">
          <Button
            onClick={() => setIsBuildingConditional(true)}
            variant="outline"
            size="sm"
          >
            <ArrowLeftRight className="h-4 w-4" />
            Conditions: {conditionsCount} set
          </Button>
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          id="true"
          isConnectable={isConnectable}
          style={{ left: "30%" }}
          className="!bg-green-400 !w-3 !h-3 !border-2 !border-background"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="false"
          isConnectable={isConnectable}
          style={{ left: "70%" }}
          className="!bg-red-400 !w-3 !h-3 !border-2 !border-background"
        />
      </div>

      <BuildConditionalDialog
        open={isBuildingConditional}
        onOpenChange={setIsBuildingConditional}
        graphId={conditionalData.graphId}
        data={{
          type: "conditional",
          label: conditionalData.label,
          conditions: conditionalData.conditions || [],
          operator: conditionalData.operator || "and",
          graphId: conditionalData.graphId,
          onConditionalChange: conditionalData.onConditionalChange,
        }}
        onConditionalChange={handleConditionalChange}
      />
    </div>
  );
}

export function PromptNode({
  data,
  isConnectable,
  selected,
  id,
}: NodeProps & { data: PromptNodeData; selected?: boolean }) {
  const labelRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(200);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isCustomPromptOpen, setIsCustomPromptOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const { user } = useAuth();

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newData = {
      ...data,
      prompt: e.target.value,
    };
    data.onPromptChange?.(id, newData);
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value;
    data.onLabelChange?.(id, newLabel);
    if (labelRef.current) {
      const tempSpan = document.createElement("span");
      tempSpan.style.visibility = "hidden";
      tempSpan.style.position = "absolute";
      tempSpan.style.whiteSpace = "pre";
      tempSpan.style.font = window.getComputedStyle(labelRef.current).font;
      tempSpan.textContent = newLabel;
      document.body.appendChild(tempSpan);
      const newWidth = Math.max(200, tempSpan.offsetWidth + 80);
      document.body.removeChild(tempSpan);
      setWidth(newWidth);
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>
  ) => {
    e.stopPropagation();
  };

  const handleGeneratePrompt = async (prompt: string) => {
    if (!user?.openai_api_key) {
      toast.error(
        "Please set your OpenAI API key in settings to use AI features"
      );
      return;
    }

    setIsGeneratingPrompt(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("No access token");
      }

      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          prompt,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate prompt");
      }

      const { response: generatedPrompt } = await response.json();
      const newData = {
        ...data,
        prompt: generatedPrompt,
      };
      data.onPromptChange?.(id, newData);
    } catch (error) {
      console.error("Error generating prompt:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to generate prompt"
      );
    } finally {
      setIsGeneratingPrompt(false);
      setIsCustomPromptOpen(false);
      setCustomPrompt("");
    }
  };

  return (
    <div className="relative">
      <NodeTypeLabel type={data.type} />
      <div
        className={cn(
          baseNodeStyles,
          "border-green-500/20",
          selected && "border-2 border-green-400/50"
        )}
        style={{ width: `${width}px` }}
      >
        <Handle
          type="target"
          position={Position.Top}
          isConnectable={isConnectable}
          className="!bg-green-400 !w-3 !h-3 !border-2 !border-background"
        />

        <div className="flex items-center justify-center mt-2">
          <input
            ref={labelRef}
            type="text"
            value={data.label}
            onChange={handleLabelChange}
            onKeyDown={handleKeyDown}
            className="w-full text-sm text-center bg-transparent border-none focus:outline-none focus:ring-0 p-0"
            aria-label="Node label"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={isGeneratingPrompt}
              >
                {isGeneratingPrompt ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  handleGeneratePrompt(
                    `Write brief, direct instructions for roleplaying: "${data.prompt}". No professional advice - just raw emotional expression. Keep it under 3 sentences. Example for "angry at therapist": Glare intensely. Use short, snappy responses. Cross arms and lean back defensively.`
                  )
                }
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Fix & Improve
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  handleGeneratePrompt(
                    `Write 1-2 sentences max for roleplaying: "${data.prompt}". Focus only on the key actions and reactions needed to show this emotional state. No professional advice.`
                  )
                }
              >
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Make Shorter
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  handleGeneratePrompt(
                    `Write detailed roleplay instructions for: "${data.prompt}". Include specific verbal responses, tone variations, gestures, expressions, and thought patterns. No professional advice - focus on raw emotional expression and method acting this state.`
                  )
                }
              >
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Make Longer
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsCustomPromptOpen(true)}>
                <MessageSquare className="h-4 w-4 mr-2" />
                Custom Prompt
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Textarea
          value={data.prompt ?? ""}
          onChange={handlePromptChange}
          onKeyDown={handleKeyDown}
          placeholder="Enter your prompt here..."
          className="w-full text-sm bg-transparent min-h-[100px] mt-2"
        />
      </div>

      <Dialog open={isCustomPromptOpen} onOpenChange={setIsCustomPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Custom AI Prompt</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Tell the AI what you want to change or improve..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCustomPromptOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                handleGeneratePrompt(
                  `For a node labeled "${data.label}", ${customPrompt}`
                )
              }
              disabled={!customPrompt.trim()}
            >
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const nodeTypes = {
  analysis: AnalysisNode,
  conditional: ConditionalNode,
  prompt: PromptNode,
};
