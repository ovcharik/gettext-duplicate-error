/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
} from "vscode-languageserver/node";

import {
  Position,
  Range,
  TextDocument,
} from "vscode-languageserver-textdocument";

import * as PO from "gettext-po-parser";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
      workspace: {
        workspaceFolders: {
          supported: true,
        },
      },
    },
  };
  return result;
});

connection.onInitialized(() => {
  // Register for all configuration changes.
  connection.client.register(
    DidChangeConfigurationNotification.type,
    undefined
  );
  connection.workspace.onDidChangeWorkspaceFolders((_event) => {
    connection.console.log("Workspace folder change event received.");
  });
});

// The example settings
interface ExampleSettings {}

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
  // Reset all cached document settings
  documentSettings.clear();

  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: "gettext-duplicate-errors",
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// Only keep settings for open documents
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  // In this simple example we get the settings for every validate run.
  const settings = await getDocumentSettings(textDocument.uri);

  // The validator creates diagnostics for all uppercase words length 2 and more
  const text = textDocument.getText();

  const parsed = PO.parse(text);

  const groups = parsed.messages.reduce((groups, message) => {
    const key = message.untranslatedString.value;
    if (!groups.has(key)) {
      groups.set(key, new Set());
    }
    groups.get(key)?.add(message);
    return groups;
  }, new Map<string, Set<PO.Message>>());

  const positionToPosition = ({ line, column }: PO.Position): Position => {
    return { line: line - 1, character: column - 1 };
  };

  const locationToRange = ({ start, end }: PO.Location): Range => {
    return {
      start: positionToPosition(start),
      end: positionToPosition(end),
    };
  };

  const diagnostics: Diagnostic[] = [...groups]
    .map(([key, value]) => value)
    .filter((value) => value.size > 1)
    .map((messages) => [...messages])
    .flatMap((messages) => {
      const [first, ...rest] = messages;

      return messages.map((message) => {
        const error: Diagnostic = {
          severity: DiagnosticSeverity.Error,
          message: "Duplicate message definition",
          range: locationToRange(message.untranslatedString.location),
          // data: first,
          relatedInformation: messages.map((msg) => {
            const isFist = msg === first;
            return {
              message: `${isFist ? "First definition" : ""}
                ${msg.translatedStrings[0].value}
              `,
              location: {
                uri: textDocument.uri,
                range: locationToRange(msg.untranslatedString.location),
              },
            };
          }),
        };

        return error;
      });
    });

  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log("We received an file change event");
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: "TypeScript",
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: "JavaScript",
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ];
  }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 1) {
    item.detail = "TypeScript details";
    item.documentation = "TypeScript documentation";
  } else if (item.data === 2) {
    item.detail = "JavaScript details";
    item.documentation = "JavaScript documentation";
  }
  return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
