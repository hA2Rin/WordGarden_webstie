// Chess Word Battle Engine
// Lightweight standalone chess logic with full legal move validation & AI opponent

export const PIECES = {
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚'
};

export const INITIAL_BOARD = [
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
  ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
];

export function createInitialChessState() {
  return {
    board: JSON.parse(JSON.stringify(INITIAL_BOARD)),
    turn: 'white', // 'white' (User) | 'black' (AI)
    phase: 'word_quiz', // 'word_quiz' | 'move_piece' | 'ai_thinking' | 'game_over'
    activeQuiz: null, // { wordId, type: 'en_to_ko'|'ko_to_en', question, options, answer, selected, checked, isCorrect, targetTurn: 'white'|'black' }
    selectedSquare: null, // [r, c]
    validMoves: [], // list of [toR, toC]
    capturedByWhite: [],
    capturedByBlack: [],
    moveHistory: [],
    winner: null,
    score: { player: 0, ai: 0, streak: 0 }
  };
}

export function isWhite(piece) {
  return piece !== '' && piece === piece.toUpperCase();
}

export function isBlack(piece) {
  return piece !== '' && piece === piece.toLowerCase();
}

export function isOpponent(piece, color) {
  if (!piece) return false;
  return color === 'white' ? isBlack(piece) : isWhite(piece);
}

export function isOwnPiece(piece, color) {
  if (!piece) return false;
  return color === 'white' ? isWhite(piece) : isBlack(piece);
}

// Generate legal moves for a piece at [r, c]
export function getPieceMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const color = isWhite(piece) ? 'white' : 'black';
  const moves = [];

  const addMove = (toR, toC) => {
    if (toR < 0 || toR > 7 || toC < 0 || toC > 7) return false;
    const dest = board[toR][toC];
    if (dest === '') {
      moves.push([toR, toC]);
      return true; // continue ray
    }
    if (isOpponent(dest, color)) {
      moves.push([toR, toC]);
      return false; // hit opponent, stop ray
    }
    return false; // hit own piece, stop ray
  };

  const type = piece.toUpperCase();

  // PAWN
  if (type === 'P') {
    const dir = color === 'white' ? -1 : 1;
    const startRow = color === 'white' ? 6 : 1;
    // Single forward
    if (r + dir >= 0 && r + dir <= 7 && board[r + dir][c] === '') {
      moves.push([r + dir, c]);
      // Double forward
      if (r === startRow && board[r + 2 * dir][c] === '') {
        moves.push([r + 2 * dir, c]);
      }
    }
    // Diagonal capture
    for (const dc of [-1, 1]) {
      const nr = r + dir, nc = c + dc;
      if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        if (isOpponent(board[nr][nc], color)) {
          moves.push([nr, nc]);
        }
      }
    }
  }

  // KNIGHT
  else if (type === 'N') {
    const knightOffsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of knightOffsets) {
      addMove(r + dr, c + dc);
    }
  }

  // BISHOP
  else if (type === 'B') {
    const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (addMove(nr, nc)) {
        nr += dr; nc += dc;
      }
    }
  }

  // ROOK
  else if (type === 'R') {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (addMove(nr, nc)) {
        nr += dr; nc += dc;
      }
    }
  }

  // QUEEN
  else if (type === 'Q') {
    const dirs = [
      [-1, -1], [-1, 1], [1, -1], [1, 1],
      [-1, 0], [1, 0], [0, -1], [0, 1]
    ];
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (addMove(nr, nc)) {
        nr += dr; nc += dc;
      }
    }
  }

  // KING
  else if (type === 'K') {
    const dirs = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    for (const [dr, dc] of dirs) {
      addMove(r + dr, c + dc);
    }
  }

  return moves;
}

// Get all legal moves for a player
export function getAllColorMoves(board, color) {
  const allMoves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isOwnPiece(board[r][c], color)) {
        const moves = getPieceMoves(board, r, c);
        for (const [toR, toC] of moves) {
          allMoves.push({ from: [r, c], to: [toR, toC], piece: board[r][c], target: board[toR][toC] });
        }
      }
    }
  }
  return allMoves;
}

// Execute move on board, handling pawn promotion & king capture
export function makeMove(chessState, fromR, fromC, toR, toC) {
  const next = JSON.parse(JSON.stringify(chessState));
  const piece = next.board[fromR][fromC];
  const target = next.board[toR][toC];

  if (target) {
    if (isWhite(target)) next.capturedByBlack.push(target);
    else next.capturedByWhite.push(target);

    // If King captured, Game Over
    if (target.toUpperCase() === 'K') {
      next.winner = isWhite(piece) ? 'white' : 'black';
      next.phase = 'game_over';
    }
  }

  // Move
  next.board[fromR][fromC] = '';
  // Pawn promotion to Queen
  if (piece === 'P' && toR === 0) next.board[toR][toC] = 'Q';
  else if (piece === 'p' && toR === 7) next.board[toR][toC] = 'q';
  else next.board[toR][toC] = piece;

  next.moveHistory.push({
    from: [fromR, fromC],
    to: [toR, toC],
    piece,
    target,
    color: next.turn
  });

  next.selectedSquare = null;
  next.validMoves = [];

  return next;
}

// Simple heuristic AI move choice
export function chooseAiMove(board, difficulty = 'normal') {
  const moves = getAllColorMoves(board, 'black');
  if (moves.length === 0) return null;
  if (difficulty === 'easy') return moves[Math.floor(Math.random() * moves.length)];

  // Piece value heuristic
  const values = { p: 10, n: 30, b: 35, r: 50, q: 90, k: 900 };

  if (difficulty === 'hard') {
    const score = (move) => {
      if (move.target === 'K') return Infinity;
      const [[fromRow, fromCol], [toRow, toCol]] = [move.from, move.to];
      const next = board.map(row => row.slice());
      const promotes = move.piece === 'p' && toRow === 7;
      next[fromRow][fromCol] = '';
      next[toRow][toCol] = promotes ? 'q' : move.piece;
      const value = piece => values[piece.toLowerCase()] ?? 0;
      const reply = getAllColorMoves(next, 'white').reduce(
        (highest, response) => Math.max(highest, value(response.target)), 0);
      const center = Math.abs(toRow - 3.5) + Math.abs(toCol - 3.5);
      return value(move.target) + (promotes ? 80 : 0) - reply - center / 10;
    };
    return moves.reduce((best, move) => {
      const rating = score(move);
      return rating > best.rating ? {move, rating} : best;
    }, {move: moves[0], rating: -Infinity}).move;
  }

  // Sort: capturing higher value is top priority, then moving toward center
  moves.sort((a, b) => {
    const valA = a.target ? (values[a.target.toLowerCase()] || 0) : 0;
    const valB = b.target ? (values[b.target.toLowerCase()] || 0) : 0;
    if (valB !== valA) return valB - valA;
    // Distance to center (3.5, 3.5)
    const distA = Math.abs(a.to[0] - 3.5) + Math.abs(a.to[1] - 3.5);
    const distB = Math.abs(b.to[0] - 3.5) + Math.abs(b.to[1] - 3.5);
    return distA - distB;
  });

  // Pick from top 3 moves to add slight variety
  const topMoves = moves.slice(0, Math.min(3, moves.length));
  return topMoves[Math.floor(Math.random() * topMoves.length)];
}
