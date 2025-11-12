import React from "react";
import type { ModalProps } from "@mantine/core";
import {
  Modal,
  Stack,
  Text,
  ScrollArea,
  Flex,
  CloseButton,
  Button,
  Group,
  Textarea,
} from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { JSONPath } from "jsonc-parser";
import { jsonToContent } from "../../../lib/utils/jsonAdapter";
import useFile from "../../../store/useFile";
import useJson from "../../../store/useJson";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";

const isPrimitiveRow = (row: NodeData["text"][number]) =>
  row.type !== "array" && row.type !== "object";

const getPrimitiveRows = (nodeRows: NodeData["text"] = []) => nodeRows.filter(isPrimitiveRow);

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"] = []) => {
  const primitives = getPrimitiveRows(nodeRows);
  if (primitives.length === 0) return "{}";
  if (primitives.length === 1 && !primitives[0].key) {
    return JSON.stringify(primitives[0].value ?? null, null, 2);
  }

  const obj = {};
  primitives.forEach(row => {
    if (row.key) obj[row.key] = row.value;
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

const getValueByPath = (root: unknown, path: JSONPath = []) => {
  if (!path.length) return root;
  return path.reduce((acc: any, segment) => {
    if (acc === null || typeof acc === "undefined") return undefined;
    return acc[segment as keyof typeof acc];
  }, root);
};

const assignValueByPath = (root: any, path: JSONPath = [], nextValue: unknown) => {
  if (!path.length) return nextValue;

  let cursor = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i];
    if (cursor === null || typeof cursor === "undefined") {
      throw new Error("Unable to resolve JSON path for the selected node.");
    }
    cursor = cursor[segment as keyof typeof cursor];
  }

  const lastSegment = path[path.length - 1];
  if (cursor === null || typeof cursor === "undefined") {
    throw new Error("Unable to resolve JSON path for the selected node.");
  }

  cursor[lastSegment as keyof typeof cursor] = nextValue;
  return root;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const primitives = React.useMemo(() => getPrimitiveRows(nodeData?.text), [nodeData?.text]);
  const normalizedContent = React.useMemo(
    () => normalizeNodeData(nodeData?.text ?? []),
    [nodeData?.text]
  );
  const supportsEditing = primitives.length > 0 && Boolean(nodeData?.path);
  const isObjectDraft = React.useMemo(() => primitives.some(row => row.key !== null), [primitives]);
  const isDirty = draft.trim() !== normalizedContent.trim();

  React.useEffect(() => {
    setDraft(normalizedContent);
    setIsEditing(false);
    setError(null);
  }, [normalizedContent, opened]);

  const handleStartEditing = () => {
    if (!supportsEditing) return;
    setIsEditing(true);
  };

  const handleCancel = () => {
    setDraft(normalizedContent);
    setIsEditing(false);
    setError(null);
  };

  const applyUpdates = React.useCallback(
    async (nextValue: unknown) => {
      if (!nodeData) return;

      const currentJson = useJson.getState().json || "{}";
      let parsedJson: any;

      try {
        parsedJson = JSON.parse(currentJson);
      } catch {
        throw new Error("The current document is not valid JSON.");
      }

      const path = nodeData.path ?? [];

      if (isObjectDraft) {
        if (typeof nextValue !== "object" || nextValue === null || Array.isArray(nextValue)) {
          throw new Error("Provide a valid JSON object for this node.");
        }

        const target = getValueByPath(parsedJson, path);
        if (typeof target !== "object" || target === null || Array.isArray(target)) {
          throw new Error("Selected node cannot be updated as an object.");
        }

        const allowedKeys = primitives
          .map(row => row.key)
          .filter((key): key is string => Boolean(key));

        allowedKeys.forEach(key => {
          if (Object.prototype.hasOwnProperty.call(nextValue, key)) {
            target[key] = (nextValue as Record<string, unknown>)[key];
          }
        });
      } else {
        parsedJson = assignValueByPath(parsedJson, path, nextValue);
      }

      const updatedJsonString = JSON.stringify(parsedJson, null, 2);
      const { setContents, format } = useFile.getState();
      const formattedContent = await jsonToContent(updatedJsonString, format);

      await setContents({ contents: formattedContent });
      useJson.setState({ json: updatedJsonString, loading: false });
      useGraph.getState().setGraph(updatedJsonString);
      const updatedNode = useGraph.getState().nodes.find(node => node.id === nodeData.id);
      if (updatedNode) useGraph.getState().setSelectedNode(updatedNode);
    },
    [isObjectDraft, nodeData, primitives]
  );

  const handleSave = async () => {
    if (!supportsEditing || !nodeData) return;

    try {
      setSaving(true);
      const parsedDraft = JSON.parse(draft || (isObjectDraft ? "{}" : "null"));
      await applyUpdates(parsedDraft);
      setIsEditing(false);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save node data.");
      return;
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Group gap="xs">
              <Button
                variant="subtle"
                onClick={handleStartEditing}
                disabled={!supportsEditing || isEditing}
              >
                Edit
              </Button>
              <Button
                onClick={handleSave}
                disabled={!isEditing || !supportsEditing || !isDirty}
                loading={saving}
              >
                Save
              </Button>
              <Button variant="default" onClick={handleCancel} disabled={!isEditing}>
                Cancel
              </Button>
              <CloseButton onClick={onClose} />
            </Group>
          </Flex>
          {isEditing ? (
            <>
              <Textarea
                value={draft}
                onChange={event => setDraft(event.currentTarget.value)}
                minRows={8}
                autosize
                styles={{ input: { fontFamily: "monospace" } }}
                placeholder={
                  isObjectDraft
                    ? '{\n  "key": "value"\n}'
                    : 'Enter a valid JSON value (example: "text" or 42)'
                }
              />
              <Text fz="xs" c="dimmed">
                Provide a valid JSON snippet. Arrays and nested objects remain unchanged.
              </Text>
              {error && (
                <Text fz="xs" c="red">
                  {error}
                </Text>
              )}
            </>
          ) : (
            <ScrollArea.Autosize mah={250} maw={600}>
              <CodeHighlight
                code={normalizedContent}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            </ScrollArea.Autosize>
          )}
          {!supportsEditing && (
            <Text fz="xs" c="dimmed">
              This node only contains nested data. Use the main editor to update it.
            </Text>
          )}
        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
