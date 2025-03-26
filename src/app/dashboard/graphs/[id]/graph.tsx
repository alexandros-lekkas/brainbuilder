"use client";

import {
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
  useState,
  useEffect,
} from "react";

import {
  ReactFlow,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Node,
  Edge,
  ReactFlowInstance,
  XYPosition,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { cn } from "@/lib/utils";
import {
  nodeTypes,
  NodeType,
  CustomNodeData,
  AnalysisNodeData,
  ConditionalNodeData,
  PromptNodeData,
} from "./nodes";
import { Controls } from "./controls";
import { AddNodeDialog } from "./add-node-dialog";
import { createClient } from "@/lib/supabase/client/client";
import { useAuth } from "@/lib/hooks/use-auth";

export interface GraphNode {
  id: string;
  label: string;
  position: { x: number; y: number };
  data: {
    type: NodeType;
    prompt?: string;
    childId?: string;
    trueChildId?: string;
    falseChildId?: string;
  };
}

const VERTICAL_SPACING = 100;
const HORIZONTAL_SPACING = 200;

export interface GraphRef {
  fitView: () => void;
  addNode: () => void;
  selectedNode: Node | null;
}

interface GraphProps {
  graphId: string;
  className?: string;
  onUpdateStart?: () => void;
  onUpdateEnd?: () => void;
}

interface FlowProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  onConnect: (params: any) => void;
  onNodeClick: (event: any, node: Node) => void;
  onInit: (instance: ReactFlowInstance) => void;
  selectedNode: Node | null;
  setSelectedNode: (node: Node | null) => void;
  handleAddNode: (type: NodeType, label: string) => void;
  isAddNodeDialogOpen: boolean;
  setIsAddNodeDialogOpen: (open: boolean) => void;
  isRootNode: boolean;
}

function Flow({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onInit,
  selectedNode,
  setSelectedNode,
  handleAddNode,
  isAddNodeDialogOpen,
  setIsAddNodeDialogOpen,
  isRootNode,
}: FlowProps) {
  const { getViewport } = useReactFlow();

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (
        selectedNode &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        const changes = [{ id: selectedNode.id, type: "remove" as const }];
        onNodesChange(changes);
      }
    },
    [selectedNode, onNodesChange]
  );

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        onInit={onInit}
        onKeyDown={onKeyDown}
      >
        <Background />
        <Controls />
      </ReactFlow>
      <AddNodeDialog
        open={isAddNodeDialogOpen}
        onOpenChange={setIsAddNodeDialogOpen}
        onAddNode={handleAddNode}
        isRootNode={isRootNode}
        hasAnalysisNode={nodes.some((node) => node.type === "analysis")}
      />
    </>
  );
}

export const Graph = forwardRef<GraphRef, GraphProps>(
  ({ graphId, className, onUpdateStart, onUpdateEnd }, ref) => {
    const { user } = useAuth();
    const supabase = createClient();

    const [isLoading, setIsLoading] = useState(true);
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const [isAddNodeDialogOpen, setIsAddNodeDialogOpen] = useState(false);

    const positionUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

    const updateNodeData = useCallback(
      async (nodeId: string, newData: any) => {
        setNodes((currentNodes) =>
          currentNodes.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, ...newData } }
              : node
          )
        );

        const { data: currentNode, error: fetchError } = await supabase
          .from("nodes")
          .select("data")
          .eq("id", nodeId)
          .single();

        if (fetchError) {
          console.error("Error fetching current node data:", fetchError);
          return false;
        }

        const mergedData = { ...currentNode.data, ...newData };

        const { error } = await supabase
          .from("nodes")
          .update({ data: mergedData })
          .eq("id", nodeId);

        if (error) {
          console.error("Error updating node data:", error);
          return false;
        }

        return true;
      },
      [supabase]
    );

    const createEdge = useCallback(
      async (sourceId: string, targetId: string, sourceHandle?: string) => {
        try {
          const { data: newEdge, error } = await supabase
            .from("edges")
            .insert({
              source_node_id: sourceId,
              target_node_id: targetId,
            })
            .select()
            .single();

          if (error) {
            console.error("Error creating edge:", error);
            return null;
          }

          const newEdgeObj: Edge = {
            id: newEdge.id,
            source: sourceId,
            target: targetId,
            ...(sourceHandle && { sourceHandle }),
          };

          return newEdgeObj;
        } catch (error) {
          console.error("Error in createEdge:", error);
          return null;
        }
      },
      [supabase]
    );

    const deleteEdge = useCallback(
      async (edgeId: string) => {
        const { error } = await supabase
          .from("edges")
          .delete()
          .eq("id", edgeId);

        if (error) {
          console.error(`Error deleting edge ${edgeId}:`, error);
          return false;
        }

        return true;
      },
      [supabase]
    );

    const updateNodeRelationships = useCallback(
      async (
        sourceNode: Node,
        targetNode: Node,
        sourceHandle?: string,
        isRemove: boolean = false
      ) => {
        if (!sourceNode || !targetNode) return;

        try {
          const nodeType = sourceNode.type as NodeType;

          if (nodeType === "analysis") {
            await updateNodeData(sourceNode.id, {
              childId: isRemove ? undefined : targetNode.id,
            });
          } else if (nodeType === "conditional") {
            if (sourceHandle === "true") {
              await updateNodeData(sourceNode.id, {
                trueChildId: isRemove ? undefined : targetNode.id,
              });
            } else if (sourceHandle === "false") {
              await updateNodeData(sourceNode.id, {
                falseChildId: isRemove ? undefined : targetNode.id,
              });
            }
          }
        } catch (error) {
          console.error("Error updating node relationships:", error);
        }
      },
      [updateNodeData]
    );

    useEffect(() => {
      async function fetchGraph() {
        if (!user || !graphId) return;
        setIsLoading(true);

        try {
          const { data: graphData, error: graphError } = await supabase
            .from("graphs")
            .select("*")
            .eq("id", graphId)
            .eq("user_id", user.id)
            .single();

          if (graphError) {
            console.error("Error fetching graph:", graphError);
            return;
          }

          if (!graphData) {
            console.error("No graph data found");
            return;
          }

          const { data: nodesData, error: nodesError } = await supabase
            .from("nodes")
            .select("*")
            .eq("graph_id", graphId);

          if (nodesError) {
            console.error("Error fetching nodes:", nodesError);
            return;
          }

          const { data: edgesData, error: edgesError } = await supabase
            .from("edges")
            .select("*")
            .in(
              "source_node_id",
              nodesData.map((node) => node.id)
            );

          if (edgesError) {
            console.error("Error fetching edges:", edgesError);
            return;
          }

          const flowNodes: Node[] = nodesData.map((node) => {
            const nodeData = node.data || {};
            const nodeType = nodeData.type || "prompt";

            const baseNodeData = {
              label: node.label,
              type: nodeType,
            };

            let fullNodeData: any = { ...baseNodeData };

            if (nodeType === "prompt") {
              fullNodeData = {
                ...baseNodeData,
                prompt: nodeData.prompt || "",
                onPromptChange: async (
                  nodeId: string,
                  newData: PromptNodeData
                ) => {
                  await updateNodeData(nodeId, { prompt: newData.prompt });
                },
              };
            } else if (nodeType === "analysis") {
              fullNodeData = {
                ...baseNodeData,
                childId: nodeData.childId,
              };
            } else if (nodeType === "conditional") {
              fullNodeData = {
                ...baseNodeData,
                trueChildId: nodeData.trueChildId,
                falseChildId: nodeData.falseChildId,
              };
            }

            return {
              id: node.id,
              position: { x: node.position_x, y: node.position_y },
              type: nodeType,
              data: fullNodeData,
            };
          });

          const flowEdges: Edge[] = edgesData.map((edge) => {
            const sourceNode = nodesData.find(
              (n) => n.id === edge.source_node_id
            );
            let sourceHandle: string | undefined = undefined;

            if (sourceNode?.data?.type === "conditional") {
              const trueChildId = sourceNode.data?.trueChildId;
              const falseChildId = sourceNode.data?.falseChildId;

              if (trueChildId && trueChildId === edge.target_node_id) {
                sourceHandle = "true";
              } else if (falseChildId && falseChildId === edge.target_node_id) {
                sourceHandle = "false";
              }
            }

            return {
              id: edge.id,
              source: edge.source_node_id,
              target: edge.target_node_id,
              ...(sourceHandle && { sourceHandle }),
            };
          });

          setNodes(flowNodes);
          setEdges(flowEdges);
          setIsLoading(false);
        } catch (error) {
          console.error("Error in fetchGraph:", error);
          setIsLoading(false);
        }
      }

      fetchGraph();
    }, [user, graphId, supabase, updateNodeData]);

    const updateGraphData = useCallback(
      async (newNodes: Node[], newEdges: Edge[]) => {
        onUpdateStart?.();
        try {
          for (const node of newNodes) {
            const { error } = await supabase
              .from("nodes")
              .update({
                position_x: node.position.x,
                position_y: node.position.y,
              })
              .eq("id", node.id);

            if (error) {
              console.error("Error updating node position:", error);
            }
          }

          return true;
        } catch (error) {
          console.error("Error in updateGraphData:", error);
          return false;
        } finally {
          onUpdateEnd?.();
        }
      },
      [supabase, onUpdateStart, onUpdateEnd]
    );

    const debouncedUpdatePositions = useCallback(
      (newNodes: Node[], newEdges: Edge[]) => {
        if (positionUpdateTimeoutRef.current) {
          clearTimeout(positionUpdateTimeoutRef.current);
        }

        positionUpdateTimeoutRef.current = setTimeout(() => {
          updateGraphData(newNodes, newEdges);
          positionUpdateTimeoutRef.current = null;
        }, 500);
      },
      [updateGraphData]
    );

    const onEdgesChangeCallback = useCallback(
      async (changes: any) => {
        const newEdges = applyEdgeChanges(changes, edges);
        setEdges(newEdges);

        const removedEdges = changes.filter(
          (change: any) => change.type === "remove"
        );

        for (const change of removedEdges) {
          const edgeId = change.id;
          const edge = edges.find((e) => e.id === edgeId);

          if (edge) {
            await deleteEdge(edgeId);

            const sourceNode = nodes.find((n) => n.id === edge.source);
            const targetNode = nodes.find((n) => n.id === edge.target);

            if (sourceNode && targetNode) {
              await updateNodeRelationships(
                sourceNode,
                targetNode,
                edge.sourceHandle || undefined,
                true
              );
            }
          }
        }
      },
      [edges, nodes, deleteEdge, updateNodeRelationships]
    );

    const deleteNode = useCallback(
      async (nodeId: string) => {
        try {
          setEdges(
            edges.filter(
              (edge) => edge.source !== nodeId && edge.target !== nodeId
            )
          );
          setNodes(nodes.filter((node) => node.id !== nodeId));

          if (selectedNode?.id === nodeId) {
            setSelectedNode(null);
          }

          const connectedEdges = edges.filter(
            (edge) => edge.source === nodeId || edge.target === nodeId
          );

          for (const edge of connectedEdges) {
            await deleteEdge(edge.id);

            if (edge.target === nodeId) {
              const sourceNode = nodes.find((n) => n.id === edge.source);
              const dummyTargetNode = { id: nodeId } as Node;

              if (sourceNode) {
                await updateNodeRelationships(
                  sourceNode,
                  dummyTargetNode,
                  edge.sourceHandle || undefined,
                  true
                );
              }
            }
          }

          const { error } = await supabase
            .from("nodes")
            .delete()
            .eq("id", nodeId);

          if (error) {
            console.error(`Error deleting node ${nodeId}:`, error);
            return false;
          }

          return true;
        } catch (error) {
          console.error("Error in deleteNode:", error);
          return false;
        }
      },
      [
        edges,
        nodes,
        selectedNode,
        supabase,
        deleteEdge,
        updateNodeRelationships,
      ]
    );

    const onNodesChangeCallback = useCallback(
      async (changes: any) => {
        const deletionChanges = changes.filter(
          (change: any) => change.type === "remove"
        );
        const otherChanges = changes.filter(
          (change: any) => change.type !== "remove"
        );

        for (const change of deletionChanges) {
          const nodeId = change.id;
          await deleteNode(nodeId);
        }

        const newNodes = applyNodeChanges(otherChanges, nodes);
        setNodes(newNodes);

        const positionChanges = otherChanges.filter(
          (change: any) => change.type === "position" && change.position
        );

        if (positionChanges.length > 0) {
          debouncedUpdatePositions(newNodes, edges);
        }
      },
      [nodes, edges, deleteNode, debouncedUpdatePositions]
    );

    const onConnect = useCallback(
      async (params: any) => {
        const sourceNode = nodes.find((node) => node.id === params.source);
        const targetNode = nodes.find((node) => node.id === params.target);

        if (!sourceNode || !targetNode) return;

        if (sourceNode.type === "prompt") {
          return;
        }

        if (sourceNode.type === "analysis") {
          const existingEdges = edges.filter(
            (edge) => edge.source === sourceNode.id
          );

          for (const edge of existingEdges) {
            await deleteEdge(edge.id);
          }
        }

        if (sourceNode.type === "conditional" && params.sourceHandle) {
          const existingConnections = edges.filter(
            (edge) =>
              edge.source === params.source &&
              edge.sourceHandle === params.sourceHandle
          );

          for (const edge of existingConnections) {
            await deleteEdge(edge.id);
          }
        }

        const newEdgeObj = await createEdge(
          sourceNode.id,
          targetNode.id,
          params.sourceHandle
        );

        if (newEdgeObj) {
          await updateNodeRelationships(
            sourceNode,
            targetNode,
            params.sourceHandle
          );

          setEdges((currentEdges) => {
            const filteredEdges = currentEdges.filter((edge) => {
              if (sourceNode.type === "analysis") {
                return edge.source !== sourceNode.id;
              }
              if (sourceNode.type === "conditional" && params.sourceHandle) {
                return !(
                  edge.source === sourceNode.id &&
                  edge.sourceHandle === params.sourceHandle
                );
              }
              return true;
            });

            return [...filteredEdges, newEdgeObj];
          });
        }
      },
      [nodes, edges, createEdge, deleteEdge, updateNodeRelationships]
    );

    const onNodeClick = useCallback((event: any, node: Node) => {
      event.stopPropagation();
      setSelectedNode(node);
    }, []);

    const handleAddNode = useCallback(
      async (type: NodeType, label: string) => {
        if (!graphId || !label || !type) {
          console.error("Missing required fields for node creation");
          return;
        }

        try {
          const center = {
            x: 500,
            y: 300,
          };

          let nodeData: any = { type };

          if (type === "prompt") {
            nodeData.prompt = "";
          }

          const { data: createdNode, error: nodeError } = await supabase
            .from("nodes")
            .insert({
              graph_id: graphId,
              label,
              position_x: center.x,
              position_y: center.y,
              data: nodeData,
            })
            .select()
            .single();

          if (nodeError) {
            console.error("Error creating node:", nodeError);
            return;
          }

          if (!createdNode) {
            console.error("No node was created");
            return;
          }

          const newNodeId = createdNode.id;

          const newNode: Node = {
            id: newNodeId,
            position: center,
            type,
            data: {
              label,
              type,
              ...(type === "prompt" && {
                prompt: "",
                onPromptChange: async (
                  nodeId: string,
                  newData: PromptNodeData
                ) => {
                  await updateNodeData(nodeId, { prompt: newData.prompt });
                },
              }),
            },
          };

          setNodes([...nodes, newNode]);

          if (selectedNode) {
            if (selectedNode.type === "prompt") {
              return;
            }

            let sourceHandle: string | undefined = undefined;

            if (selectedNode.type === "conditional") {
              const hasTrueConnection = edges.some(
                (e) => e.source === selectedNode.id && e.sourceHandle === "true"
              );

              if (!hasTrueConnection) {
                sourceHandle = "true";
              } else {
                const hasFalseConnection = edges.some(
                  (e) =>
                    e.source === selectedNode.id && e.sourceHandle === "false"
                );

                if (!hasFalseConnection) {
                  sourceHandle = "false";
                }
              }
            }

            const newEdge = await createEdge(
              selectedNode.id,
              newNodeId,
              sourceHandle
            );

            if (newEdge) {
              await updateNodeRelationships(
                selectedNode,
                newNode,
                sourceHandle
              );

              setEdges((prev) => [...prev, newEdge]);
            }
          }
        } catch (error) {
          console.error("Error in handleAddNode:", error);
        }
      },
      [
        nodes,
        edges,
        selectedNode,
        graphId,
        supabase,
        createEdge,
        updateNodeRelationships,
        updateNodeData,
      ]
    );

    useImperativeHandle(ref, () => ({
      fitView: () => {
        reactFlowInstance.current?.fitView();
      },
      addNode: () => {
        setIsAddNodeDialogOpen(true);
      },
      selectedNode,
    }));

    useEffect(() => {
      return () => {
        if (positionUpdateTimeoutRef.current) {
          clearTimeout(positionUpdateTimeoutRef.current);
        }
      };
    }, []);

    if (isLoading) {
      return (
        <div className="h-screen w-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900" />
        </div>
      );
    }

    return (
      <div className={cn("h-screen w-screen", className)}>
        <ReactFlowProvider>
          <Flow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeCallback}
            onEdgesChange={onEdgesChangeCallback}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onInit={(instance) => {
              reactFlowInstance.current = instance;
            }}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            handleAddNode={handleAddNode}
            isAddNodeDialogOpen={isAddNodeDialogOpen}
            setIsAddNodeDialogOpen={setIsAddNodeDialogOpen}
            isRootNode={nodes.length === 0}
          />
        </ReactFlowProvider>
      </div>
    );
  }
);

Graph.displayName = "Graph";
