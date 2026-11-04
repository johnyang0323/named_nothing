/**
 * Editorial copy for REAL places fetched from Kakao.
 *
 * Kakao gives names, addresses and coordinates, not reasons to visit.
 * These lines are gentle, generic suggestions per kind of place. They
 * describe what one could do, never facts about a specific business.
 */
export const CATEGORY_TEMPLATES = {
  cafe: {
    experienceType: 'restful',
    estimatedStay: '1시간 안팎',
    whyVisit: [
      '창가 자리에 앉아 바깥을 보는 것만으로 하루가 조금 느려져요.',
      '처음 가보는 카페는 그 자체로 작은 여행이에요.',
      '잠깐 앉아 오늘 하고 싶은 것을 천천히 떠올려보기 좋아요.',
    ],
    activities: ['메뉴판에서 처음 보는 음료 시켜보기', '창가 자리에서 지나가는 사람 구경하기', '오늘 본 것 하나를 수첩에 적어보기'],
  },
  bookstore: {
    experienceType: 'enriching',
    estimatedStay: '30분 안팎',
    whyVisit: [
      '베스트셀러 대신 누군가의 취향을 빌려 읽어볼 수 있어요.',
      '책장 사이를 걷는 것만으로도 생각이 정리돼요.',
    ],
    activities: ['제목만 보고 오늘의 문장 하나 고르기', '평소라면 안 집었을 분야의 책 펼쳐보기', '표지가 마음에 드는 책 한 권 찾기'],
  },
  park: {
    experienceType: 'restful',
    estimatedStay: '20분에서 1시간',
    whyVisit: ['아무것도 하지 않아도 어색하지 않은 곳이에요.', '바깥 공기를 마시면 다음 걸음이 가벼워져요.'],
    activities: ['벤치에 10분 앉아 있기', '가장 큰 나무 한 그루 찾아보기', '하늘 사진 한 장 남기기'],
  },
  library: {
    experienceType: 'productive',
    estimatedStay: '1시간 안팎',
    whyVisit: ['미뤄둔 생각을 정리하기 좋은, 적당히 조용한 공간이에요.', '잡지 코너 하나로도 낯선 세계를 엿볼 수 있어요.'],
    activities: ['낯선 분야 잡지 펼쳐보기', '다음에 가보고 싶은 곳 세 군데 적어보기', '창가 자리에서 책 한 챕터 읽기'],
  },
  gallery: {
    experienceType: 'enriching',
    estimatedStay: '40분 안팎',
    whyVisit: ['한 사람의 시선을 천천히 따라가 보는 경험이 생각보다 깊어요.', '작은 전시 하나가 오늘의 이야깃거리가 돼요.'],
    activities: ['가장 오래 눈이 머무는 작품 하나 찾기', '작품 제목을 보기 전에 제목 지어보기', '방명록에 한 줄 남기기'],
  },
  museum: {
    experienceType: 'enriching',
    estimatedStay: '30분에서 1시간',
    whyVisit: ['익숙한 동네에도 아직 모르는 이야기가 있어요.', '잠깐 다른 시간과 장소에 다녀올 수 있어요.'],
    activities: ['가장 오래된 것 하나 기억해두기', '마음에 남는 설명문 한 줄 찍어두기', '나오는 길에 기념엽서 구경하기'],
  },
  street: {
    experienceType: 'scenic',
    estimatedStay: '20분 안팎',
    whyVisit: ['늘 지나치던 동네에도 아직 모르는 풍경이 있어요.', '천천히 걷다 보면 작은 디테일이 눈에 들어와요.'],
    activities: ['가장 마음에 드는 건물 하나 찾기', '처음 보는 갈림길에서 한 번 꺾어보기', '오늘의 색 하나 사진으로 남기기'],
  },
  market: {
    experienceType: 'active',
    estimatedStay: '30분에서 1시간',
    whyVisit: ['소리와 냄새가 많은 곳이라 감각이 깨어나요.', '작은 간식 하나면 충분한 나들이가 돼요.'],
    activities: ['처음 먹어보는 간식 하나 사기', '가장 오래된 것 같은 가게 찾아보기', '제철 과일 하나 구경하기'],
  },
  workshop: {
    experienceType: 'creative',
    estimatedStay: '40분에서 1시간',
    whyVisit: ['손을 움직이면 머릿속이 조용해져요.', '잘 만들지 않아도 그 자체로 오늘의 기념품이 돼요.'],
    activities: ['작업 중인 물건 구경하기', '체험이 가능한지 물어보기', '마음에 드는 재료 하나 만져보기'],
  },
  recordshop: {
    experienceType: 'enriching',
    estimatedStay: '30분 안팎',
    whyVisit: ['표지만 보고 음악을 상상해보는 재미가 있어요.', '귀로 하는 산책을 해볼 수 있어요.'],
    activities: ['표지가 마음에 드는 음반 하나 골라보기', '요즘 자주 트는 곡 물어보기'],
  },
  trail: {
    experienceType: 'active',
    estimatedStay: '30분에서 1시간',
    whyVisit: ['목적지 없이 걷기 좋은 길이에요. 원하는 만큼만 걸으면 돼요.', '걷다 보면 다음에 갈 곳이 자연스럽게 떠올라요.'],
    activities: ['20분만 걷고 돌아오기', '길 위에서 오늘의 색 하나 찾기', '처음 보는 갈림길로 가보기'],
  },
};
